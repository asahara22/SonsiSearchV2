"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { parseAddressOrSearch } from "@/lib/address";
import { buildSearchUrl, getSearchEngine } from "@/lib/search-engine";

export function SearchForm({ initialQuery = "", compact = false }: { initialQuery?: string; compact?: boolean }) {
  const [query, setQuery] = useState(initialQuery);
  const router = useRouter();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    const parsed = parseAddressOrSearch(value);
    if (parsed.kind === "url") router.push(`/browser?url=${encodeURIComponent(parsed.value)}`);
    else if (parsed.kind === "search") router.push(`/browser?url=${encodeURIComponent(buildSearchUrl(parsed.value, getSearchEngine()))}`);
  }

  return (
    <form className={`searchbox${compact ? " compact" : ""}`} onSubmit={submit} role="search">
      <span className="search-symbol" aria-hidden="true">⌕</span>
      <input aria-label="URLまたは検索" placeholder={compact ? "URLまたは検索" : "Search or enter a URL"} value={query} onChange={(event) => setQuery(event.target.value)} />
      <button className="search-submit" type="submit" aria-label="Search">→</button>
    </form>
  );
}
