"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { buildSearchUrl, getSearchEngine } from "@/lib/search-engine";

export function SearchResults({ query }: { query: string }) {
  const router = useRouter();

  useEffect(() => {
    if (query.trim()) router.replace(`/browser?url=${encodeURIComponent(buildSearchUrl(query, getSearchEngine()))}`);
  }, [query, router]);
  return <section aria-live="polite"><h1 style={{ fontSize: 19, fontWeight: 600, margin: "30px 0 10px" }}>「{query}」を検索しています…</h1><p className="status">選択した検索サイトをSonsiSearch Browserで開いています。</p></section>;
}
