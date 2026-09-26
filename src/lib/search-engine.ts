export const SEARCH_ENGINE_STORAGE_KEY = "sonsisearch:search-engine";
export const DEFAULT_SEARCH_ENGINE = "yahoo" as const;

export const SEARCH_ENGINES = {
  duckduckgo: { label: "DuckDuckGo", baseUrl: "https://duckduckgo.com/?q=" },
  startpage: { label: "Startpage", baseUrl: "https://www.startpage.com/sp/search?query=" },
  brave: { label: "Brave Search", baseUrl: "https://search.brave.com/search?q=" },
  yahoo: { label: "Yahoo Search", baseUrl: "https://search.yahoo.com/search?p=" },
} as const;

export type SearchEngine = keyof typeof SEARCH_ENGINES;

export function normalizeSearchEngine(value: string | null | undefined): SearchEngine {
  return value && Object.prototype.hasOwnProperty.call(SEARCH_ENGINES, value) ? value as SearchEngine : DEFAULT_SEARCH_ENGINE;
}

export function getSearchEngine(): SearchEngine {
  return typeof window === "undefined"
    ? DEFAULT_SEARCH_ENGINE
    : normalizeSearchEngine(localStorage.getItem(SEARCH_ENGINE_STORAGE_KEY));
}

export function buildSearchUrl(query: string, engine: SearchEngine = DEFAULT_SEARCH_ENGINE): string {
  return `${SEARCH_ENGINES[engine].baseUrl}${encodeURIComponent(query.trim())}`;
}
