"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { parseAddressOrSearch } from "@/lib/address";

export function SearchForm({ initialQuery = "", compact = false }: { initialQuery?: string; compact?: boolean }) {
  const [query, setQuery] = useState(initialQuery);
  const [imageSearch, setImageSearch] = useState(false);
  const router = useRouter();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    if (imageSearch) {
      const destination = new URL("https://duckduckgo.com/");
      destination.searchParams.set("q", value);
      destination.searchParams.set("iax", "images");
      destination.searchParams.set("ia", "images");
      router.push(`/browser?url=${encodeURIComponent(destination.href)}`);
      return;
    }
    const parsed = parseAddressOrSearch(value);
    if (parsed.kind === "url") router.push(`/browser?url=${encodeURIComponent(parsed.value)}`);
    else if (parsed.kind === "search") router.push(`/search?q=${encodeURIComponent(parsed.value)}`);
  }

  return (
    <form className={`searchbox${compact ? " compact" : ""}`} onSubmit={submit} role="search">
      <span className="search-symbol" aria-hidden="true">⌕</span>
      <input aria-label="URLまたは検索" placeholder={compact ? "URLまたは検索" : "Search or enter a URL"} value={query} onChange={(event) => setQuery(event.target.value)} />
      <button className={`image-search-toggle${imageSearch ? " is-active" : ""}`} type="button" aria-pressed={imageSearch} onClick={() => setImageSearch((value) => !value)}>▧ <span>画像</span></button>
      <button className="search-submit" type="submit" aria-label="Search">→</button>
    </form>
  );
}
