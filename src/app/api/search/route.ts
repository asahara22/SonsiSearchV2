import { normalizeSearchEngine, buildSearchUrl } from "@/lib/search-engine";

type SearchResult = { title: string; url: string; description: string };
type CacheEntry = { expires: number; results: SearchResult[] };

const MAX_QUERY_LENGTH = 300;
const MAX_RESPONSE_BYTES = 1_000_000;
const CACHE_TTL_MS = 30_000;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const resultCache = new Map<string, CacheEntry>();
const requestTimes = new Map<string, number[]>();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") || "").trim();
  if (!query) return json({ error: "検索語を入力してください。" }, 400);
  if (query.length > MAX_QUERY_LENGTH) return json({ error: "検索語が長すぎます。" }, 400);

  const engine = normalizeSearchEngine(params.get("engine"));
  if (engine !== "duckduckgo") return json({ redirect: buildSearchUrl(query, engine) });

  const clientIp = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "unknown";
  const retryAfter = takeRateLimit(clientIp);
  if (retryAfter > 0) return json({ error: "検索が混み合っています。少し待って再度お試しください。" }, 429, { "Retry-After": String(retryAfter) });

  const cacheKey = query.toLocaleLowerCase();
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return json({ results: cached.results });

  try {
    const endpoint = new URL("https://html.duckduckgo.com/html/");
    endpoint.searchParams.set("q", query);
    const response = await fetch(endpoint, {
      headers: {
        Accept: "text/html",
        "User-Agent": "Mozilla/5.0 (compatible; SonsiSearchV2/1.0)",
      },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!response.ok) return json({ error: `DuckDuckGoがHTTP ${response.status}を返しました。` }, 502);
    if (!response.body || Number(response.headers.get("content-length") || 0) > MAX_RESPONSE_BYTES) {
      return json({ error: "検索応答がサイズ上限を超えています。" }, 502);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return json({ error: "検索応答がサイズ上限を超えています。" }, 502);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const html = new TextDecoder().decode(bytes);
    const results = parseDuckDuckGoResults(html);
    if (results.length) {
      resultCache.set(cacheKey, { results, expires: Date.now() + CACHE_TTL_MS });
      if (resultCache.size > 500) {
        const now = Date.now();
        for (const [key, entry] of resultCache) if (entry.expires <= now) resultCache.delete(key);
        if (resultCache.size > 500) resultCache.delete(resultCache.keys().next().value!);
      }
    }
    return json({ results });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return json({ error: timedOut ? "検索がタイムアウトしました。" : "DuckDuckGoへ接続できませんでした。" }, 502);
  }
}

function parseDuckDuckGoResults(html: string): SearchResult[] {
  const links = [...html.matchAll(/<a\b(?=[^>]*\bclass=["'][^"']*\bresult__a\b[^"']*["'])[^>]*>([\s\S]*?)<\/a>/gi)];
  const results: SearchResult[] = [];
  for (let index = 0; index < links.length && results.length < 15; index += 1) {
    const match = links[index];
    const attributes = match[0].slice(0, match[0].indexOf(">"));
    const href = attributes.match(/\bhref=["']([^"']+)["']/i)?.[1];
    const title = plainText(match[1]);
    const start = match.index || 0;
    const end = links[index + 1]?.index ?? Math.min(html.length, (match.index || 0) + 5000);
    const block = html.slice(start, end);
    const snippet = block.match(/<a\b(?=[^>]*\bclass=["'][^"']*\bresult__snippet\b[^"']*["'])[^>]*>([\s\S]*?)<\/a>/i)?.[1]
      || block.match(/<div\b(?=[^>]*\bclass=["'][^"']*\bresult__snippet\b[^"']*["'])[^>]*>([\s\S]*?)<\/div>/i)?.[1]
      || "";
    if (!href || !title) continue;
    try {
      let target = new URL(decodeEntities(href), "https://html.duckduckgo.com");
      if (target.hostname.endsWith("duckduckgo.com") && target.pathname.startsWith("/l/")) {
        const destination = target.searchParams.get("uddg");
        if (!destination) continue;
        target = new URL(destination);
      }
      if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) continue;
      results.push({ title: title.slice(0, 300), url: target.href, description: plainText(snippet).slice(0, 1200) });
    } catch { /* Ignore malformed or non-web result links. */ }
  }
  return results;
}

function plainText(value: string) {
  return decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const radix = code[1]?.toLowerCase() === "x" ? 16 : 10;
      const digits = code.slice(radix === 16 ? 2 : 1);
      const point = Number.parseInt(digits, radix);
      return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " } as Record<string, string>)[code.toLowerCase()] || entity;
  });
}

function takeRateLimit(ip: string): number {
  const now = Date.now();
  const recent = (requestTimes.get(ip) || []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    requestTimes.set(ip, recent);
    return Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - recent[0])) / 1000));
  }
  recent.push(now);
  requestTimes.set(ip, recent);
  if (requestTimes.size > 10_000) {
    for (const [key, times] of requestTimes) if (!times.length || now - times[times.length - 1] >= RATE_WINDOW_MS) requestTimes.delete(key);
  }
  return 0;
}

function json(body: object, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", ...headers } });
}
