"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Result = { title: string; url: string; description: string };

export function SearchResults({ query }: { query: string }) {
  const [state, setState] = useState<{ query: string; status: "loading" | "ready" | "error"; results: Result[]; error: string }>({ query, status: "loading", results: [], error: "" });

  useEffect(() => {
    if (!query.trim()) return;
    const controller = new AbortController();
    fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "検索に失敗しました。");
        setState({ query, status: "ready", results: data.results as Result[], error: "" });
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name !== "AbortError") setState({ query, status: "error", results: [], error: reason.message });
      })
      .finally(() => {
        if (!controller.signal.aborted) setState((current) => current.query === query && current.status === "loading" ? { ...current, status: "ready" } : current);
      });
    return () => controller.abort();
  }, [query]);

  if (!query.trim()) return <p className="status">検索語を入力してください。</p>;
  const current = state.query === query ? state : { query, status: "loading" as const, results: [], error: "" };
  return (
    <section aria-live="polite">
      <h1 style={{ fontSize: 19, fontWeight: 600, margin: "30px 0 10px" }}>「{query}」の検索結果</h1>
      {current.status === "loading" && <p className="status">検索しています…</p>}
      {current.status === "error" && <p className="error">{current.error}</p>}
      {current.status === "ready" && current.results.length === 0 && <p className="status">検索結果はありません。</p>}
      {current.results.map((result, index) => {
        const target = safeHttpUrl(result.url);
        if (!target) return null;
        return (
          <article className="result" key={`${target}-${index}`}>
            <h2><a href={target} target="_blank" rel="noreferrer">{result.title}</a></h2>
            <div className="result-url">{new URL(target).hostname}</div>
            <p>{result.description}</p>
            <div className="result-actions">
              <Link href={`/browser?url=${encodeURIComponent(target)}`}>Open in SonsiSearch</Link>
              <a href={target} target="_blank" rel="noreferrer">Original ↗</a>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
