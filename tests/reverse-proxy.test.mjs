import test from "node:test";
import assert from "node:assert/strict";
import { clearProxyCacheForTests, injectReaderBridge, parseProxyTarget, resolvePublicTarget, rewriteCss, rewriteHtml, serveReverseProxy, toProxyPath } from "../proxy/upstream/reverse-proxy.js";

test("proxy routes preserve target path and query without changing host", () => {
  const href = "https://www.example.com/docs/a%20b?q=hello%20world&x=1#section";
  const path = toProxyPath(href);
  assert.match(path, /^\/proxy\/https\/www\.example\.com\/docs\/a%20b\?__ssq=/);
  assert.ok(path.endsWith("#section"));
  assert.equal(new URL(path, "https://sonsisearch.example").origin, "https://sonsisearch.example");
  const target = parseProxyTarget(path);
  assert.equal(target.href, href.split("#", 1)[0]);
});

test("proxy routes support the documented direct URL form and its query string", () => {
  const target = parseProxyTarget("/proxy/https://example.com/a?search=one&mode=2");
  assert.equal(target.href, "https://example.com/a?search=one&mode=2");
  assert.equal(parseProxyTarget("/proxy/https:/example.com/a").href, "https://example.com/a");
  assert.equal(parseProxyTarget("/proxy/https/example.com/a").href, "https://example.com/a");
});

test("proxy target validation rejects credentials, unsupported protocols, and non-web ports", async () => {
  assert.throws(() => parseProxyTarget("/proxy/https://user:pass@example.com/"), /Credentials/);
  await assert.rejects(resolvePublicTarget(new URL("file:///etc/passwd"), async () => []), /HTTP\(S\)/);
  await assert.rejects(resolvePublicTarget(new URL("https://example.com:8443/"), async () => []), /ports/);
});

test("proxy does not forward write methods or request bodies", async () => {
  const response = mockResponse();
  await assert.rejects(serveReverseProxy({ method: "POST", headers: {} }, response, "/proxy/https://example.com/"), /GET and HEAD/);
  await assert.rejects(serveReverseProxy({ method: "GET", headers: { "content-length": "12" } }, response, "/proxy/https://example.com/"), /Request bodies/);
});

test("private, loopback, link-local, and metadata addresses are denied", async () => {
  for (const address of ["127.0.0.1", "10.0.0.2", "172.20.1.3", "192.168.1.1", "169.254.169.254", "168.63.129.16", "::1", "fd00::1", "fe80::1", "100.100.100.200"]) {
    await assert.rejects(resolvePublicTarget(new URL(`http://${address.includes(":") ? `[${address}]` : address}/`)), /not allowed|non-public/);
  }
  await assert.rejects(resolvePublicTarget(new URL("https://metadata.google.internal/"), async () => []), /not allowed/);
});

test("DNS rebinding defense rejects a host if any resolved address is non-public", async () => {
  await assert.rejects(
    resolvePublicTarget(new URL("https://rebind.example/"), async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
    /non-public/,
  );
});

test("public targets are resolved and returned for address-pinned upstream requests", async () => {
  const result = await resolvePublicTarget(new URL("https://example.com/"), async (host, options) => {
    assert.equal(host, "example.com");
    assert.equal(options.all, true);
    return [{ address: "93.184.216.34", family: 4 }];
  });
  assert.deepEqual(result, [{ address: "93.184.216.34", family: 4 }]);
});

test("HTML rewriting honors base href and proxies navigation and asset URLs", () => {
  const html = '<meta http-equiv="Content-Security-Policy" content="default-src self"><base href="https://cdn.example/assets/"><a href="../article?q=1&amp;x=2" target="_blank">Read</a><img src="hero.png" srcset="small.png 1x, large.png 2x"><form action="/submit"><input></form><div style="background:url(../bg.png)"></div><style>.x{background:url(icon.svg)}@import "theme.css";</style><script>const sample = "<a href=\"https://untouched.example\">";</script>';
  const rewritten = rewriteHtml(html, "https://origin.example/page");
  assert.match(rewritten, /href="\/proxy\/https\/cdn\.example\/article\?__ssq=/);
  assert.match(rewritten, /src="\/proxy\/https\/cdn\.example\/assets\/hero\.png"/);
  assert.match(rewritten, /srcset="\/proxy\/https\/cdn\.example\/assets\/small\.png 1x, \/proxy\/https\/cdn\.example\/assets\/large\.png 2x"/);
  assert.match(rewritten, /action="\/proxy\/https\/cdn\.example\/submit"/);
  assert.match(rewritten, /background:url\(\/proxy\/https\/cdn\.example\/bg\.png\)/);
  assert.match(rewritten, /@import "\/proxy\/https\/cdn\.example\/assets\/theme\.css"/);
  assert.doesNotMatch(rewritten, /<base\b/i);
  assert.doesNotMatch(rewritten, /http-equiv="Content-Security-Policy"/i);
  assert.match(rewritten, /target="_self"/);
  assert.equal(rewritten.match(/<script>([\s\S]*?)<\/script>/)?.[1], html.match(/<script>([\s\S]*?)<\/script>/)?.[1]);
});

test("reader bridge is injected after head metadata and before the page body", () => {
  const injected = injectReaderBridge("<html><head><meta charset=\"utf-8\"></head><body>page</body></html>");
  assert.ok(injected.indexOf("sonsisearch-reverse-proxy") > injected.indexOf("<head>"));
  assert.ok(injected.indexOf("sonsisearch-reverse-proxy") < injected.indexOf("</head>"));
  assert.ok(injected.indexOf("sonsisearch-reverse-proxy") < injected.indexOf("<body>"));
});

test("CSS rewriting proxies relative and absolute URL references but leaves data URLs", () => {
  const css = 'a{background:url("../img/a.png")}@import url(https://assets.example/theme.css);b{mask:url(data:image/svg+xml,%3Csvg%3E)}';
  const rewritten = rewriteCss(css, "https://site.example/css/main.css");
  assert.match(rewritten, /\/proxy\/https\/site\.example\/img\/a\.png/);
  assert.match(rewritten, /\/proxy\/https\/assets\.example\/theme\.css/);
  assert.match(rewritten, /data:image\/svg\+xml,%3Csvg%3E/);
});

function mockResponse() {
  return {
    status: 0,
    headers: {},
    body: Buffer.alloc(0),
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = Buffer.alloc(0)) { this.body = Buffer.from(body); },
  };
}

test("HTML responses use an isolated origin, compress for clients, and hit the bounded memory cache", async () => {
  clearProxyCacheForTests();
  let upstreamCalls = 0;
  const resolver = async () => [{ address: "93.184.216.34", family: 4 }];
  const fetcher = async () => {
    upstreamCalls++;
    return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: Buffer.from(`<main>${"x".repeat(1500)}<a href="/next">next</a></main>`) };
  };
  const request = { method: "GET", headers: { "accept-encoding": "gzip" } };
  const first = mockResponse();
  await serveReverseProxy(request, first, "/proxy/https://cache.example/page", { resolver, fetcher });
  assert.equal(first.status, 200);
  assert.match(first.headers["Content-Security-Policy"], /sandbox allow-scripts/);
  assert.match(first.headers["Content-Security-Policy"], /connect-src 'none'/);
  assert.equal(first.headers["content-encoding"], "gzip");
  assert.equal(first.headers["X-SonsiSearch-Cache"], "MISS");
  const second = mockResponse();
  await serveReverseProxy(request, second, "/proxy/https://cache.example/page", { resolver, fetcher });
  assert.equal(second.headers["X-SonsiSearch-Cache"], "HIT");
  assert.equal(upstreamCalls, 1);
  clearProxyCacheForTests();
});

test("redirects to private addresses are rejected before a same-domain redirect is emitted", async () => {
  clearProxyCacheForTests();
  let upstreamCalls = 0;
  const response = mockResponse();
  await assert.rejects(serveReverseProxy(
    { method: "GET", headers: {} },
    response,
    "/proxy/https://redirect.example/start",
    {
      resolver: async () => [{ address: "93.184.216.34", family: 4 }],
      fetcher: async () => { upstreamCalls++; return { status: 302, headers: { location: "http://127.0.0.1/admin" }, body: Buffer.alloc(0) }; },
    },
  ), /not allowed|non-public/);
  assert.equal(upstreamCalls, 1);
  assert.equal(response.status, 0);
});

test("public upstream redirects remain on the SonsiSearch host and are validated", async () => {
  clearProxyCacheForTests();
  const response = mockResponse();
  await serveReverseProxy(
    { method: "GET", headers: {} },
    response,
    "/proxy/https://redirect.example/start",
    {
      resolver: async () => [{ address: "93.184.216.34", family: 4 }],
      fetcher: async () => ({ status: 301, headers: { location: "https://next.example/read?q=1" }, body: Buffer.alloc(0) }),
    },
  );
  assert.equal(response.status, 302);
  assert.match(response.headers.Location, /^\/proxy\/https\/next\.example\/read\?__ssq=/);
  clearProxyCacheForTests();
});

test("personalized upstream responses are not cached and upstream cookies are stripped", async () => {
  clearProxyCacheForTests();
  let upstreamCalls = 0;
  const options = {
    resolver: async () => [{ address: "93.184.216.34", family: 4 }],
    fetcher: async () => {
      upstreamCalls++;
      return { status: 200, headers: { "content-type": "text/html", "set-cookie": "session=secret; Path=/" }, body: Buffer.from("private") };
    },
  };
  for (let index = 0; index < 2; index++) {
    const response = mockResponse();
    await serveReverseProxy({ method: "GET", headers: {} }, response, "/proxy/https://personal.example/", options);
    assert.equal(response.headers["Set-Cookie"], undefined);
    assert.equal(response.headers["Cache-Control"], "private, no-store");
    assert.equal(response.headers["X-SonsiSearch-Cache"], "BYPASS");
  }
  assert.equal(upstreamCalls, 2);
  clearProxyCacheForTests();
});

test("upstream no-store and zero max-age cache directives are respected", async () => {
  clearProxyCacheForTests();
  let upstreamCalls = 0;
  const options = {
    resolver: async () => [{ address: "93.184.216.34", family: 4 }],
    fetcher: async () => {
      upstreamCalls++;
      return { status: 200, headers: { "content-type": "text/css", "cache-control": "max-age=0" }, body: Buffer.from("body{color:red}") };
    },
  };
  for (let index = 0; index < 2; index++) {
    const response = mockResponse();
    await serveReverseProxy({ method: "GET", headers: {} }, response, "/proxy/https://no-cache.example/theme.css", options);
    assert.equal(response.headers["Cache-Control"], "private, no-store");
    assert.equal(response.headers["X-SonsiSearch-Cache"], "BYPASS");
  }
  assert.equal(upstreamCalls, 2);
  clearProxyCacheForTests();
});
