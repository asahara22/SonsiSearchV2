import { createHash } from "node:crypto";

type SearchResult = { title: string; url: string; description: string };
const MAX_RESPONSE_BYTES = 1_000_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const recentSearches = new Map<string, number[]>();

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query) return Response.json({ error: "検索語を入力してください。" }, { status: 400 });
  if (query.length > 300) return Response.json({ error: "検索語が長すぎます。" }, { status: 400 });
  const ip = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "unknown";
  const retryAfter = checkRateLimit(ip);
  if (retryAfter > 0) {
    return Response.json({ error: "検索回数の上限に達しました。しばらくしてから再度お試しください。" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  const apiUrl = process.env.SEARCH_API_URL;
  const apiKey = process.env.SEARCH_API_KEY;
  if (!apiUrl || !apiKey) {
    return Response.json({ error: "検索APIが未設定です。SEARCH_API_URLとSEARCH_API_KEYを設定してください。" }, { status: 503 });
  }

  let endpoint: URL;
  try {
    endpoint = new URL(apiUrl);
  } catch {
    return Response.json({ error: "SEARCH_API_URLの設定が正しくありません。" }, { status: 500 });
  }
  if (endpoint.protocol !== "https:") {
    return Response.json({ error: "検索APIはHTTPS endpointを指定してください。" }, { status: 500 });
  }
  endpoint.searchParams.set("q", query);

  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!response.ok) return Response.json({ error: `検索プロバイダーがHTTP ${response.status}を返しました。` }, { status: 502 });
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_RESPONSE_BYTES || !response.body) {
      return Response.json({ error: "検索APIの応答サイズが上限を超えています。" }, { status: 502 });
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
        return Response.json({ error: "検索APIの応答サイズが上限を超えています。" }, { status: 502 });
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder().decode(body)); }
    catch { return Response.json({ error: "検索APIがJSON以外の応答を返しました。" }, { status: 502 }); }
    const list = Array.isArray(payload) ? payload : isRecord(payload) ? payload.results ?? payload.items : undefined;
    if (!Array.isArray(list)) return Response.json({ error: "検索API応答にresults配列がありません。" }, { status: 502 });

    const results: SearchResult[] = list.slice(0, 20).flatMap((item): SearchResult[] => {
      if (!isRecord(item)) return [];
      const title = typeof item.title === "string" ? item.title : "";
      const url = typeof item.url === "string" ? item.url : typeof item.link === "string" ? item.link : "";
      const description = typeof item.description === "string" ? item.description : typeof item.snippet === "string" ? item.snippet : "";
      try {
        const parsed = new URL(url);
        return title && ["http:", "https:"].includes(parsed.protocol) ? [{ title, url: parsed.href, description }] : [];
      } catch { return []; }
    });
    return Response.json({ results });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return Response.json({ error: timedOut ? "検索プロバイダーがタイムアウトしました。" : "検索プロバイダーに接続できませんでした。" }, { status: 502 });
  }
}

function checkRateLimit(ip: string): number {
  const key = createHash("sha256").update(ip).digest("hex");
  const now = Date.now();
  const recent = (recentSearches.get(key) || []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    recentSearches.set(key, recent);
    return Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - recent[0])) / 1000));
  }
  recent.push(now);
  recentSearches.set(key, recent);
  if (recentSearches.size > 10_000) {
    for (const [candidate, times] of recentSearches) {
      if (!times.length || now - times[times.length - 1] >= RATE_WINDOW_MS) recentSearches.delete(candidate);
    }
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
