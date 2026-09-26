"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";

type Entry = { title: string; url: string; visited?: number };
const emptyEntries: Entry[] = [];
const cache: Record<string, { raw: string | null | undefined; items: Entry[] }> = {};

function getSavedItems(key: string) {
  const item = cache[key] || (cache[key] = { raw: undefined, items: [] });
  const raw = localStorage.getItem(key);
  if (raw !== item.raw) {
    item.raw = raw;
    try { item.items = raw ? JSON.parse(raw) as Entry[] : []; } catch { item.items = []; }
  }
  return item.items;
}

function getHost(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function formatTime(timestamp?: number) {
  if (!timestamp || !Number.isFinite(timestamp)) return "日時不明";
  if (Number.isNaN(new Date(timestamp).getTime())) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(timestamp);
}

function getDay(timestamp?: number) {
  if (!timestamp || !Number.isFinite(timestamp)) return "日時不明";
  if (Number.isNaN(new Date(timestamp).getTime())) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(timestamp);
}

export function SavedSites({ kind }: { kind: "history" | "bookmarks" }) {
  const key = `sonsisearch:${kind}`;
  const [query, setQuery] = useState("");
  const items = useSyncExternalStore((notify) => {
    window.addEventListener("sonsisearch:saved", notify);
    window.addEventListener("storage", notify);
    return () => { window.removeEventListener("sonsisearch:saved", notify); window.removeEventListener("storage", notify); };
  }, () => getSavedItems(key), () => emptyEntries);

  const filtered = useMemo(() => {
    if (kind !== "history") return items;
    const ordered = [...items].sort((a, b) => (b.visited || 0) - (a.visited || 0));
    if (!query.trim()) return ordered;
    const needle = query.trim().toLocaleLowerCase();
    return ordered.filter((item) => `${item.title} ${item.url} ${getHost(item.url)}`.toLocaleLowerCase().includes(needle));
  }, [items, kind, query]);

  const groups = useMemo(() => {
    const result: { label: string; entries: Entry[] }[] = [];
    for (const entry of filtered) {
      const label = getDay(entry.visited);
      let group = result[result.length - 1];
      if (!group || group.label !== label) { group = { label, entries: [] }; result.push(group); }
      group.entries.push(entry);
    }
    return result;
  }, [filtered]);

  function save(next: Entry[]) {
    localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new Event("sonsisearch:saved"));
  }
  function remove(url: string) { save(items.filter((item) => item.url !== url)); }

  return <main className="data-page page-enter">
    <span className="eyebrow">YOUR DEVICE</span><h1>{kind === "history" ? "Browsing history" : "Bookmarks"}</h1>
    <p className="hint">Stored on this device. Your browsing activity is not uploaded to SonsiSearch.</p>
    {kind === "history" && <div className="history-tools"><label className="history-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles and addresses" aria-label="Search browsing history" /></label><span className="history-count">{filtered.length} / {items.length} visits</span>{items.length > 0 && <button className="history-clear" onClick={() => save([])}>Clear history</button>}</div>}
    {filtered.length ? kind === "history" ? <div className="history-groups">{groups.map((group) => <section className="history-group" key={group.label}><h2><span>{group.label}</span><small>{group.entries.length} visits</small></h2><div className="saved-list">{group.entries.map((item, index) => <SavedRow key={`${item.url}-${item.visited ?? index}`} item={item} history onRemove={remove} />)}</div></section>)}</div> : <div className="saved-list">{filtered.map((item, index) => <SavedRow key={`${item.url}-${index}`} item={item} onRemove={remove} />)}</div> : <div className="browser-welcome glass-panel"><div className="welcome-emblem">{kind === "history" ? "◷" : "☆"}</div><h2>{query ? "No matching visits" : "Nothing here yet"}</h2><p>{query ? "Try another title, site name, or address." : kind === "history" ? "Pages you read in SonsiSearch will show up here." : "Save a page from the Browser to find it here."}</p><Link className="action-button" href={kind === "history" ? "/browser" : "/"}>Explore the web</Link></div>}
  </main>;
}

function SavedRow({ item, history = false, onRemove }: { item: Entry; history?: boolean; onRemove: (url: string) => void }) {
  const host = getHost(item.url);
  const validDate = item.visited && Number.isFinite(item.visited) && !Number.isNaN(new Date(item.visited).getTime()) ? new Date(item.visited).toISOString() : undefined;
  return <article className="saved-row glass-panel"><span className="site-glyph">{host[0]?.toUpperCase() || "?"}</span><span className="saved-row-main"><strong>{item.title || host}</strong><small>{host}</small>{history && <time dateTime={validDate}>{formatTime(item.visited)}</time>}</span><Link className="saved-open" href={`/browser?url=${encodeURIComponent(item.url)}`}>Open</Link><button onClick={() => onRemove(item.url)} aria-label={`Remove ${item.title || host}`}>Remove</button></article>;
}
