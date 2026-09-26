"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buildSearchUrl, getSearchEngine } from "@/lib/search-engine";

type Result = { title: string; url: string; description: string };
type SearchResponse = { results?: Result[]; redirect?: string; error?: string };

export function SearchResults({ query }: { query: string }) {
  const [state, setState] = useState<{ query: string; status: "loading" | "ready" | "error"; results: Result[]; error: string }>({ query, status: "loading", results: [], error: "" });
  const router = useRouter();

  useEffect(() => {
    if (!query.trim()) return;
    const controller = new AbortController();
    const engine = getSearchEngine();
    fetch(`/api/search?q=${encodeURIComponent(query)}&engine=${engine}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as SearchResponse;
        if (!response.ok) throw new Error(data.error || "検索に失敗しました。");
        if (data.redirect) {
          router.replace(`/browser?url=${encodeURIComponent(data.redirect)}`);
          return;
        }
        setState({ query, status: "ready", results: data.results || [], error: "" });
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name !== "AbortError") setState({ query, status: "error", results: [], error: reason.message });
      });
    return () => controller.abort();
  }, [query, router]);

  if (!query.trim()) return <p className="status">検索語を入力してください。</p>;
  const current = state.query === query ? state : { query, status: "loading" as const, results: [], error: "" };
  const fallback = buildSearchUrl(query, getSearchEngine());
  return <section aria-live="polite">
    <h1 style={{ fontSize: 19, fontWeight: 600, margin: "30px 0 10px" }}>「{query}」の検索結果</h1>
    {current.status === "loading" && <p className="status">検索しています…</p>}
    {current.status === "error" && <><p className="error">{current.error}</p><Link className="action-button" href={`/browser?url=${encodeURIComponent(fallback)}`}>検索サイトをBrowserで開く ↗</Link></>}
    {current.status === "ready" && current.results.length === 0 && <><p className="status">検索結果を取得できませんでした。</p><Link className="action-button" href={`/browser?url=${encodeURIComponent(fallback)}`}>検索サイトをBrowserで開く ↗</Link></>}
    {current.results.map((result, index) => {
      const target = safeHttpUrl(result.url);
      if (!target) return null;
      return <article className="result" key={`${target}-${index}`}>
        <h2><Link href={`/browser?url=${encodeURIComponent(target)}`} prefetch={false}>{result.title}</Link></h2>
        <div className="result-url">{new URL(target).hostname}</div>
        {result.description && <p>{result.description}</p>}
        <div className="result-actions"><Link href={`/browser?url=${encodeURIComponent(target)}`} prefetch={false}>Open in SonsiSearch</Link><a href={target} target="_blank" rel="noreferrer">Original ↗</a></div>
      </article>;
    })}
  </section>;
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
