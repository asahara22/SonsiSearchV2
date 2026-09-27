import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { brotliCompress, constants as zlibConstants, createBrotliDecompress, createGunzip, createInflate, gzip } from "node:zlib";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import ipaddr from "ipaddr.js";

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);
const MAX_TARGET_LENGTH = 16_384;
const MAX_QUERY_LENGTH = 8_192;
const MAX_RESPONSE_BYTES = positiveInt(process.env.SONSI_PROXY_MAX_RESPONSE_BYTES, 8 * 1024 * 1024);
const MAX_CACHE_ENTRY_BYTES = 1024 * 1024;
const MAX_CACHE_BYTES = 24 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 400;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 12_000;
const CACHE_TTLS = { html: 60_000, css: 10 * 60_000, asset: 60 * 60_000 };
const cache = new Map();
const inflight = new Map();
let cacheBytes = 0;

export class ProxyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseProxyTarget(requestUrl) {
  let route;
  try { route = new URL(requestUrl, "http://sonsisearch.invalid"); }
  catch { throw new ProxyError("Invalid proxy URL."); }

  const raw = route.pathname.slice("/proxy/".length);
  let target;
  if (raw.length > MAX_TARGET_LENGTH) throw new ProxyError("Target URL is too long.");
  try {
    // Accept the old literal URL form, including the single-slash variant
    // normalized by some address bars, plus the stable /proxy/https/host form.
    const legacy = raw.match(/^(https?):\/{1,2}([^/]+)(\/.*)?$/i);
    const stable = raw.match(/^(https?)\/([^/]+)(\/.*)?$/i);
    const reconstructed = legacy
      ? `${legacy[1]}://${legacy[2]}${legacy[3] || "/"}`
      : stable
        ? `${stable[1]}://${stable[2]}${stable[3] || "/"}`
        : null;
    if (!reconstructed) throw new Error("Invalid proxy route");
    target = new URL(reconstructed);
  }
  catch { throw new ProxyError("Invalid target URL."); }
  if (target.username || target.password) throw new ProxyError("Credentials in target URLs are not allowed.");
  if (!["http:", "https:"].includes(target.protocol)) throw new ProxyError("Only HTTP and HTTPS targets are allowed.");
  if (target.hash) target.hash = "";

  const encodedQuery = route.searchParams.get("__ssq");
  if (encodedQuery !== null) {
    if (encodedQuery.length > MAX_QUERY_LENGTH || (encodedQuery && !encodedQuery.startsWith("?"))) throw new ProxyError("Target query is too long or malformed.");
    target.search = encodedQuery;
  } else if (route.search) {
    if (route.search.length > MAX_QUERY_LENGTH) throw new ProxyError("Target query is too long.");
    target.search = route.search;
  }
  return target;
}

export function toProxyPath(value) {
  const target = value instanceof URL ? new URL(value.href) : new URL(value);
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) throw new ProxyError("Only credential-free HTTP(S) URLs can be proxied.");
  const hash = target.hash;
  target.hash = "";
  const search = target.search ? `?__ssq=${encodeURIComponent(target.search)}` : "";
  return `/proxy/${target.protocol.slice(0, -1)}/${target.host}${target.pathname}${search}${hash}`;
}

function checkedAddress(address) {
  const normalized = String(address).replace(/^\[|\]$/g, "").split("%", 1)[0];
  if (!isIP(normalized)) return false;
  if (normalized === "168.63.129.16") return false; // Azure platform/metadata virtual IP.
  try {
    let parsed = ipaddr.parse(normalized);
    if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
    return parsed.range() === "unicast";
  } catch { return false; }
}

export async function resolvePublicTarget(target, resolver = dnsLookup, selfHosts = []) {
  if (!(target instanceof URL)) target = new URL(target);
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) throw new ProxyError("Only credential-free HTTP(S) targets are allowed.");
  const defaultPort = target.protocol === "https:" ? "443" : "80";
  const port = target.port || defaultPort;
  if (port !== "80" && port !== "443") throw new ProxyError("Only standard web ports 80 and 443 are allowed.");
  const host = target.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host || host.includes("%") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test") || host === "metadata" || host === "metadata.google.internal") {
    throw new ProxyError("Private, local, or metadata hosts are not allowed.", 403);
  }
  const blockedHosts = new Set([
    ...(selfHosts || []),
    process.env.RENDER_EXTERNAL_HOSTNAME || "",
    ...(process.env.SONSI_PROXY_SELF_HOSTS || "").split(","),
  ].map((entry) => String(entry).trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "")).filter(Boolean));
  if (blockedHosts.has(host)) throw new ProxyError("The SonsiSearch host cannot be proxied back to itself.", 403);

  let addresses;
  if (isIP(host)) addresses = [{ address: host, family: isIP(host) }];
  else {
    try { addresses = await resolver(host, { all: true, verbatim: true }); }
    catch { throw new ProxyError("The target host could not be resolved.", 502); }
  }
  if (!addresses.length || addresses.some(({ address }) => !checkedAddress(address))) throw new ProxyError("The target resolved to a private, reserved, or non-public IP address.", 403);
  return addresses;
}

function fetchOnce(target, addresses, method) {
  return new Promise((resolve, reject) => {
    const transport = target.protocol === "https:" ? https : http;
    const host = target.hostname.replace(/^\[|\]$/g, "");
    let settled = false;
    const finishReject = (error) => { if (!settled) { settled = true; reject(error); } };
    const request = transport.request({
      protocol: target.protocol,
      hostname: host,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method,
      servername: isIP(host) ? undefined : host,
      lookup(_hostname, options, callback) {
        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SonsiSearchV2/2.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/css,*/*;q=0.8",
        "Accept-Encoding": "gzip, br, deflate",
        Connection: "close",
      },
      timeout: TIMEOUT_MS,
    }, (response) => {
      const status = response.statusCode || 502;
      const headers = response.headers;
      const declaredLength = Number(headers["content-length"] || 0);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        response.destroy();
        finishReject(new ProxyError("The upstream response exceeds the configured size limit.", 413));
        return;
      }
      if (method === "HEAD" || [301, 302, 303, 307, 308, 304].includes(status)) {
        response.destroy();
        if (!settled) { settled = true; resolve({ status, headers, body: Buffer.alloc(0) }); }
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          response.destroy(new ProxyError("The upstream response exceeds the configured size limit.", 413));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (!settled) { settled = true; resolve({ status, headers, body: Buffer.concat(chunks, size) }); }
      });
      response.on("error", finishReject);
    });
    const hardTimeout = setTimeout(() => request.destroy(new ProxyError("The upstream request timed out.", 504)), TIMEOUT_MS);
    hardTimeout.unref?.();
    request.once("close", () => clearTimeout(hardTimeout));
    request.on("timeout", () => request.destroy(new ProxyError("The upstream request timed out.", 504)));
    request.on("error", finishReject);
    request.end();
  });
}

function cacheTtl(contentType, headers = {}) {
  let ttl = /^text\/html\b|application\/xhtml\+xml/i.test(contentType || "") ? CACHE_TTLS.html
    : /^text\/css\b/i.test(contentType || "") ? CACHE_TTLS.css
      : /^(?:image\/|font\/|application\/font|application\/javascript|text\/javascript)/i.test(contentType || "") ? CACHE_TTLS.asset
        : 0;
  if (!ttl) return 0;
  const cacheControl = String(headers["cache-control"] || "");
  const maxAge = cacheControl.match(/(?:^|,)\s*(?:s-maxage|max-age)\s*=\s*(\d+)/i);
  if (maxAge) ttl = Math.min(ttl, Number(maxAge[1]) * 1000);
  else if (headers.expires) {
    const expiresAt = Date.parse(headers.expires);
    if (Number.isFinite(expiresAt)) ttl = Math.min(ttl, Math.max(0, expiresAt - Date.now()));
  }
  return ttl;
}

function cacheable(response) {
  const cc = String(response.headers["cache-control"] || "").toLowerCase();
  const vary = String(response.headers.vary || "").toLowerCase();
  return response.status === 200 && !response.headers["set-cookie"] && !/private|no-store|no-cache|must-revalidate/.test(cc) && !/(?:^|,\s*)(?:\*|cookie|authorization)(?:\s*,|$)/.test(vary) && !response.headers["content-encoding"];
}

function decompressResponse(response) {
  const encoding = String(response.headers["content-encoding"] || "").trim().toLowerCase();
  if (!encoding || !response.body.length) return Promise.resolve(response);
  const decoder = encoding === "gzip" ? createGunzip()
    : encoding === "br" ? createBrotliDecompress()
      : encoding === "deflate" ? createInflate()
        : null;
  if (!decoder) return Promise.reject(new ProxyError("The upstream uses an unsupported content encoding.", 502));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const stream = Readable.from([response.body]).pipe(decoder);
    stream.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) stream.destroy(new ProxyError("The decoded upstream response exceeds the configured size limit.", 413));
      else chunks.push(chunk);
    });
    stream.once("error", (error) => reject(error instanceof ProxyError ? error : new ProxyError("The upstream response could not be decoded.", 502)));
    stream.once("end", () => {
      const headers = { ...response.headers };
      delete headers["content-encoding"];
      delete headers["content-length"];
      resolve({ ...response, headers, body: Buffer.concat(chunks, size) });
    });
  });
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    cache.delete(key);
    cacheBytes -= entry.body.length;
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function cacheSet(key, response, ttl) {
  if (!ttl || response.body.length > MAX_CACHE_ENTRY_BYTES) return;
  const previous = cache.get(key);
  if (previous) { cacheBytes -= previous.body.length; cache.delete(key); }
  while (cache.size >= MAX_CACHE_ENTRIES || cacheBytes + response.body.length > MAX_CACHE_BYTES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const removed = cache.get(oldest);
    cache.delete(oldest);
    cacheBytes -= removed.body.length;
  }
  cache.set(key, { ...response, expires: Date.now() + ttl, ttl });
  cacheBytes += response.body.length;
}

async function fetchCached(target, addresses, method, requester = fetchOnce) {
  const key = `${method}:${target.href}`;
  if (method === "GET") {
    const cached = cacheGet(key);
    if (cached) return { ...cached, cached: true };
    if (inflight.has(key)) return inflight.get(key);
  }
  const pending = requester(target, addresses, method).then((rawResponse) => method === "GET" ? decompressResponse(rawResponse) : rawResponse).then((response) => {
    const ttl = cacheTtl(response.headers["content-type"], response.headers);
    if (method === "GET" && cacheable(response)) cacheSet(key, response, ttl);
    return { ...response, cached: false, ttl: method === "GET" && cacheable(response) && response.body.length <= MAX_CACHE_ENTRY_BYTES ? ttl : 0 };
  }).finally(() => inflight.delete(key));
  if (method === "GET") inflight.set(key, pending);
  return pending;
}

function decodeHtmlEntities(value) {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function escapeHtmlAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function rewriteUrl(raw, base) {
  const value = decodeHtmlEntities(raw.trim());
  if (!value || value.startsWith("#") || /^(?:data|blob|javascript|mailto|tel|about|vbscript):/i.test(value)) return raw;
  try {
    const resolved = new URL(value, base);
    if (!["http:", "https:"].includes(resolved.protocol) || resolved.username || resolved.password) return raw;
    return escapeHtmlAttribute(toProxyPath(resolved));
  } catch { return raw; }
}

export function rewriteCss(css, base) {
  return css
    .replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi, (match, doubleQuoted, singleQuoted, bare) => {
      const original = doubleQuoted ?? singleQuoted ?? bare ?? "";
      const rewritten = rewriteUrl(original, base);
      if (rewritten === original) return match;
      const quote = doubleQuoted !== undefined ? '"' : singleQuoted !== undefined ? "'" : "";
      const clean = rewritten.replace(/&amp;/g, "&");
      return `url(${quote}${clean}${quote})`;
    })
    .replace(/(@import\s+)(?:"([^"]+)"|'([^']+)')/gi, (match, prefix, doubleQuoted, singleQuoted) => {
      const original = doubleQuoted ?? singleQuoted;
      const rewritten = rewriteUrl(original, base).replace(/&amp;/g, "&");
      if (rewritten === original) return match;
      const quote = doubleQuoted !== undefined ? '"' : "'";
      return `${prefix}${quote}${rewritten}${quote}`;
    });
}

function getAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function rewriteSrcset(value, base) {
  const candidates = [];
  let index = 0;
  while (index < value.length) {
    while (index < value.length && /[\s,]/.test(value[index])) index++;
    if (index >= value.length) break;
    const start = index;
    while (index < value.length && !/\s/.test(value[index]) && (value.slice(start, start + 5).toLowerCase() === "data:" || value[index] !== ",")) index++;
    const url = value.slice(start, index);
    while (index < value.length && value[index] !== ",") index++;
    const descriptor = value.slice(start + url.length, index).trim();
    candidates.push(`${rewriteUrl(url, base)}${descriptor ? ` ${descriptor}` : ""}`);
    if (value[index] === ",") index++;
  }
  return candidates.join(", ");
}

function rewriteTag(tag, base) {
  const name = tag.match(/^<\s*([a-z][\w:-]*)/i)?.[1]?.toLowerCase();
  if (!name || name === "base" || tag.startsWith("</") || tag.startsWith("<!") || tag.startsWith("<?")) return name === "base" ? "" : tag;
  if (name === "meta" && /^\s*content-security-policy\s*$/i.test(getAttribute(tag, "http-equiv") || "")) return "";
  if (name === "meta" && /^\s*refresh\s*$/i.test(getAttribute(tag, "http-equiv") || "")) {
    tag = tag.replace(/(content\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>]+))/i, (whole, prefix, attr, dq, sq, bare) => {
      const value = dq ?? sq ?? bare ?? "";
      const replaced = value.replace(/(url\s*=\s*)(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i, (_m, p, a, b, c) => `${p}"${rewriteUrl(a ?? b ?? c, base)}"`);
      return `${prefix}"${replaced}"`;
    });
  }
  tag = tag.replace(/(\s)(href|src|action|formaction|poster|data|xlink:href|cite|background|manifest)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (whole, space, name, attr, dq, sq, bare) => {
    const original = dq ?? sq ?? bare ?? "";
    const rewritten = rewriteUrl(original, base);
    if (rewritten === original) return whole;
    const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : '"';
    return `${space}${name}=${quote}${rewritten}${quote}`;
  });
  tag = tag.replace(/(\s)srcset\s*=\s*("([^"]*)"|'([^']*)')/gi, (_whole, space, _attr, dq, sq) => {
    const value = dq ?? sq ?? "";
    const quote = dq !== undefined ? '"' : "'";
    return `${space}srcset=${quote}${rewriteSrcset(value, base)}${quote}`;
  });
  tag = tag.replace(/(\s)style\s*=\s*("([^"]*)"|'([^']*)')/gi, (_whole, space, _attr, dq, sq) => {
    const value = dq ?? sq ?? "";
    const quote = dq !== undefined ? '"' : "'";
    return `${space}style=${quote}${rewriteCss(value, base)}${quote}`;
  });
  if (name === "a" || name === "area") tag = tag.replace(/\s+target\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, ' target="_self"');
  return tag;
}

export function rewriteHtml(html, pageUrl) {
  let base = new URL(pageUrl);
  const baseTag = html.match(/<base\b[^>]*>/i)?.[0];
  const baseHref = baseTag && getAttribute(baseTag, "href");
  if (baseHref) {
    try { base = new URL(decodeHtmlEntities(baseHref), base); } catch { /* Ignore invalid base tags. */ }
  }

  let result = "";
  let cursor = 0;
  const lower = html.toLowerCase();
  while (cursor < html.length) {
    const open = html.indexOf("<", cursor);
    if (open < 0) { result += html.slice(cursor); break; }
    result += html.slice(cursor, open);
    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4);
      if (end < 0) { result += html.slice(open); break; }
      result += html.slice(open, end + 3);
      cursor = end + 3;
      continue;
    }
    let quote = "";
    let end = open + 1;
    for (; end < html.length; end++) {
      const char = html[end];
      if (quote) { if (char === quote) quote = ""; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
    }
    if (end >= html.length) { result += html.slice(open); break; }
    const tag = html.slice(open, end + 1);
    result += rewriteTag(tag, base);
    cursor = end + 1;
    const rawName = tag.match(/^<\s*(script|style|textarea|title|xmp|noembed|noframes)\b/i)?.[1]?.toLowerCase();
    if (rawName && !/\/\s*>$/.test(tag)) {
      const closeAt = lower.indexOf(`</${rawName}`, cursor);
      if (closeAt < 0) { result += rawName === "style" ? rewriteCss(html.slice(cursor), base) : html.slice(cursor); break; }
      result += rawName === "style" ? rewriteCss(html.slice(cursor, closeAt), base) : html.slice(cursor, closeAt);
      cursor = closeAt;
    }
  }
  return result;
}

const READER_BRIDGE = `(()=>{
  const marker="sonsisearch-reverse-proxy";
  const notify=(type)=>{try{parent.postMessage({source:marker,type,url:targetUrl()},"*")}catch{}};
  function targetUrl(){
    try{
      const route=new URL(location.href);
      const raw=route.pathname.slice("/proxy/".length);
      const legacy=raw.match(/^(https?):\\/{1,2}([^/]+)(\\/.*)?$/i);
      const stable=raw.match(/^(https?)\\/([^/]+)(\\/.*)?$/i);
      const match=legacy||stable;if(!match)return "";
      const target=new URL(match[1]+"://"+match[2]+(match[3]||"/"));
      const query=route.searchParams.get("__ssq");
      if(query!==null) target.search=query;
      else if(route.search) target.search=route.search;
      target.hash=route.hash;
      return target.href;
    }catch{return ""}
  }
  function proxyPath(value){
    const target=new URL(value);const hash=target.hash;const query=target.search;
    target.hash="";target.search="";
    return "/proxy/"+target.protocol.slice(0,-1)+"/"+target.host+target.pathname+(query?"?__ssq="+encodeURIComponent(query):"")+hash;
  }
  addEventListener("message",event=>{
    if(event.source!==parent||event.data?.source!=="sonsisearch-browser")return;
    if(event.data.type==="back")history.back();
    else if(event.data.type==="forward")history.forward();
    else if(event.data.type==="reload")location.reload();
    else if(event.data.type==="navigate"&&typeof event.data.url==="string"){
      try{const target=new URL(event.data.url);if(["http:","https:"].includes(target.protocol)&&!target.username&&!target.password)location.assign(proxyPath(target.href))}catch{}
    }
  });
  for(const method of ["pushState","replaceState"]){const original=history[method];history[method]=function(...args){const result=original.apply(this,args);setTimeout(()=>notify("location"),0);return result}};
  addEventListener("popstate",()=>notify("location"));addEventListener("hashchange",()=>notify("location"));
  notify("ready");
  addEventListener("load",()=>notify("loaded"),{once:true});
  if(document.readyState==="complete")notify("loaded");
})();`;

export function injectReaderBridge(html, xhtml = false) {
  const script = xhtml ? `<script><![CDATA[${READER_BRIDGE}]]></script>` : `<script>${READER_BRIDGE}</script>`;
  const closingHead = html.search(/<\/head\s*>/i);
  if (closingHead >= 0) return `${html.slice(0, closingHead)}${script}${html.slice(closingHead)}`;
  for (const expression of [/<body\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype\s+html[^>]*>/i]) {
    const opening = expression.exec(html);
    if (opening) {
      const offset = opening.index + opening[0].length;
      return `${html.slice(0, offset)}${script}${html.slice(offset)}`;
    }
  }
  return `${script}${html}`;
}

function decodeText(body, contentType) {
  const charset = contentType?.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1]?.toLowerCase() || "utf-8";
  try { return new TextDecoder(charset).decode(body); }
  catch { return null; }
}

async function compressForClient(body, req, headers) {
  const contentType = String(headers["content-type"] || "");
  if (body.length < 1024 || !/^(?:text\/|application\/(?:javascript|json|xml|xhtml\+xml)|image\/svg\+xml)/i.test(contentType)) return body;
  const accept = String(req.headers["accept-encoding"] || "").toLowerCase();
  const quality = (name) => {
    const item = accept.split(",").map((part) => part.trim()).find((part) => part.split(";", 1)[0] === name);
    return item ? Number(item.match(/;\s*q=([0-9.]+)/)?.[1] ?? 1) : 0;
  };
  try {
    if (quality("br") > 0) {
      headers["content-encoding"] = "br";
      headers.vary = mergeVary(headers.vary, "Accept-Encoding");
      return await brotliAsync(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } });
    }
    if (quality("gzip") > 0) {
      headers["content-encoding"] = "gzip";
      headers.vary = mergeVary(headers.vary, "Accept-Encoding");
      return await gzipAsync(body, { level: 5 });
    }
  } catch { /* Compression is an optimization; serve the identity body. */ }
  delete headers["content-encoding"];
  return body;
}

function mergeVary(current, value) {
  const values = new Set(String(current || "").split(",").map((entry) => entry.trim()).filter(Boolean));
  values.add(value);
  return [...values].join(", ");
}

function safeResponseHeaders(upstream, ttl) {
  const headers = {};
  for (const name of ["content-type", "content-encoding", "last-modified", "expires", "refresh"]) {
    if (upstream[name]) headers[name] = String(upstream[name]);
  }
  headers["X-Content-Type-Options"] = "nosniff";
  headers["Referrer-Policy"] = "no-referrer";
  if (ttl) headers["Cache-Control"] = `private, max-age=${Math.floor(ttl / 1000)}, stale-while-revalidate=30`;
  else headers["Cache-Control"] = "private, no-store";
  return headers;
}

export async function serveReverseProxy(req, res, requestUrl, options = {}) {
  if (!new Set(["GET", "HEAD"]).has(req.method)) throw new ProxyError("Only GET and HEAD are supported. Forms and writes are disabled.", 405);
  if (Number(req.headers["content-length"] || 0) > 0 || req.headers["transfer-encoding"]) throw new ProxyError("Request bodies are not accepted.", 413);
  const target = parseProxyTarget(requestUrl);
  let current = target;
  let response;
  let ttl = 0;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const addresses = await resolvePublicTarget(current, options.resolver || dnsLookup, options.selfHosts || []);
    response = await fetchCached(current, addresses, req.method, options.fetcher || fetchOnce);
    ttl = response.ttl || 0;
    if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.location) break;
    if (hop === MAX_REDIRECTS) throw new ProxyError("Too many upstream redirects.", 508);
    let redirected;
    try { redirected = new URL(response.headers.location, current); }
    catch { throw new ProxyError("The upstream returned an invalid redirect.", 502); }
    await resolvePublicTarget(redirected, options.resolver || dnsLookup, options.selfHosts || []);
    res.writeHead(302, {
      Location: toProxyPath(redirected),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    return res.end();
  }

  if (!response || response.status < 200 || response.status >= 600) throw new ProxyError("The upstream returned an invalid response.", 502);
  const contentType = String(response.headers["content-type"] || "application/octet-stream");
  let body = response.body;
  let rewrittenText = false;
  if (!response.headers["content-encoding"] && /^(?:text\/html\b|application\/xhtml\+xml\b)/i.test(contentType) && req.method === "GET") {
    const text = decodeText(body, contentType);
    if (text !== null) { body = Buffer.from(injectReaderBridge(rewriteHtml(text, current.href), /^application\/xhtml\+xml/i.test(contentType)), "utf8"); rewrittenText = true; }
  } else if (!response.headers["content-encoding"] && /^text\/css\b/i.test(contentType) && req.method === "GET") {
    const text = decodeText(body, contentType);
    if (text !== null) { body = Buffer.from(rewriteCss(text, current.href), "utf8"); rewrittenText = true; }
  }

  const headers = safeResponseHeaders(response.headers, ttl);
  if (rewrittenText) headers["content-type"] = `${/^application\/xhtml\+xml/i.test(contentType) ? "application/xhtml+xml" : /^text\/css/i.test(contentType) ? "text/css" : "text/html"}; charset=utf-8`;
  // Opaque origin prevents proxied scripts and active documents from reading
  // SonsiSearch storage/cookies. Forms, popups, downloads, and top navigation
  // stay disabled; scripts remain enabled for ordinary page rendering.
  headers["Content-Security-Policy"] = "sandbox allow-scripts; connect-src 'none'";
  if (response.headers.refresh) {
    const refresh = String(response.headers.refresh).match(/^(\s*\d+\s*;\s*url\s*=\s*)(.+)$/i);
    if (refresh) {
      try { headers.refresh = `${refresh[1]}"${toProxyPath(new URL(refresh[2].replace(/^['"]|['"]$/g, ""), current))}"`; }
      catch { delete headers.refresh; }
    } else delete headers.refresh;
  }
  if (response.cached) headers["X-SonsiSearch-Cache"] = "HIT";
  else headers["X-SonsiSearch-Cache"] = ttl ? "MISS" : "BYPASS";
  if (req.method === "HEAD") {
    if (response.headers["content-length"]) headers["Content-Length"] = String(response.headers["content-length"]);
    res.writeHead(response.status, headers);
    return res.end();
  }
  if (!headers["content-encoding"]) body = await compressForClient(body, req, headers);
  headers["Content-Length"] = String(body.length);
  res.writeHead(response.status, headers);
  res.end(body);
}

export function clearProxyCacheForTests() {
  cache.clear();
  inflight.clear();
  cacheBytes = 0;
}
