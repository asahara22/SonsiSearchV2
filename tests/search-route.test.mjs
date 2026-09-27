import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../src/app/api/search/route.ts";

function request(query, ip, engine = "duckduckgo") {
  return new Request(`http://localhost/api/search?q=${encodeURIComponent(query)}&engine=${engine}`, {
    headers: { "x-real-ip": ip },
  });
}

test("DuckDuckGo results are normalized and unsafe schemes are rejected", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).hostname, "html.duckduckgo.com");
    assert.equal(new Headers(init.headers).get("accept"), "text/html");
    return new Response('<a class="result__a" href="https://example.com/path">Safe</a><a class="result__snippet">A result</a><a class="result__a" href="javascript:alert(1)">Unsafe</a>');
  };
  try {
    const response = await GET(request("demo", "192.0.2.10"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      results: [{ title: "Safe", url: "https://example.com/path", description: "A result" }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Yahoo is the default search engine and query validation still applies", async () => {
  const response = await GET(new Request("http://localhost/api/search?q=demo"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { redirect: "https://search.yahoo.com/search?p=demo" });
  assert.equal((await GET(request("", "192.0.2.11"))).status, 400);
});

test("DuckDuckGo search works without an API key and reports upstream errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  try {
    assert.equal((await GET(request("query", "192.0.2.12"))).status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("search route limits provider response bytes", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1_000_001));
      controller.close();
    },
  }));
  try {
    const response = await GET(request("oversized", "192.0.2.13"));
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /サイズ/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("search route applies a per-IP request limit", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ results: [] });
  try {
    for (let index = 0; index < 30; index += 1) {
      assert.equal((await GET(request("query", "192.0.2.14"))).status, 200);
    }
    const limited = await GET(request("query", "192.0.2.14"));
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
