import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../src/app/api/search/route.ts";

function request(query, ip) {
  return new Request(`http://localhost/api/search?q=${encodeURIComponent(query)}`, {
    headers: { "x-real-ip": ip },
  });
}

test("search route normalizes provider results and rejects unsafe schemes", async () => {
  process.env.SEARCH_API_URL = "https://provider.example/search";
  process.env.SEARCH_API_KEY = "test-secret";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer test-secret");
    return Response.json({ results: [
      { title: "Safe", url: "https://example.com/path", description: "A result" },
      { title: "Unsafe", url: "javascript:alert(1)", description: "discard" },
    ] });
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

test("search route validates query and provider configuration", async () => {
  const originalUrl = process.env.SEARCH_API_URL;
  const originalKey = process.env.SEARCH_API_KEY;
  delete process.env.SEARCH_API_URL;
  delete process.env.SEARCH_API_KEY;
  try {
    assert.equal((await GET(request("", "192.0.2.11"))).status, 400);
    assert.equal((await GET(request("query", "192.0.2.12"))).status, 503);
  } finally {
    if (originalUrl === undefined) delete process.env.SEARCH_API_URL;
    else process.env.SEARCH_API_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SEARCH_API_KEY;
    else process.env.SEARCH_API_KEY = originalKey;
  }
});

test("search route limits provider response bytes", async () => {
  process.env.SEARCH_API_URL = "https://provider.example/search";
  process.env.SEARCH_API_KEY = "test-secret";
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
  process.env.SEARCH_API_URL = "https://provider.example/search";
  process.env.SEARCH_API_KEY = "test-secret";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ results: [] });
  try {
    for (let index = 0; index < 20; index += 1) {
      assert.equal((await GET(request("query", "192.0.2.14"))).status, 200);
    }
    const limited = await GET(request("query", "192.0.2.14"));
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
