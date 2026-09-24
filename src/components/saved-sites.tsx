"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

type Entry = { title: string; url: string; visited: number };
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
export function SavedSites({ kind }: { kind: "history" | "bookmarks" }) {
  const key = `sonsisearch:${kind}`;
  const items = useSyncExternalStore((notify) => {
    window.addEventListener("sonsisearch:saved", notify); window.addEventListener("storage", notify);
    return () => { window.removeEventListener("sonsisearch:saved", notify); window.removeEventListener("storage", notify); };
  }, () => getSavedItems(key), () => emptyEntries);
  function remove(url: string) {
    const next = items.filter((item) => item.url !== url);
    localStorage.setItem(key, JSON.stringify(next)); window.dispatchEvent(new Event("sonsisearch:saved"));
  }
  return <main className="data-page page-enter"><span className="eyebrow">YOUR DEVICE</span><h1>{kind === "history" ? "Browsing history" : "Bookmarks"}</h1><p className="hint">Stored on this device. Your browsing activity is not uploaded to SonsiSearch.</p>
    {items.length ? <div className="saved-list">{items.map((item) => <article className="saved-row glass-panel" key={item.url}><span className="site-glyph">{(new URL(item.url).hostname[0] || "?").toUpperCase()}</span><span className="saved-row-main"><strong>{item.title}</strong><small>{item.url}</small></span><Link className="saved-open" href={`/browser?url=${encodeURIComponent(item.url)}`}>Open</Link><button onClick={() => remove(item.url)} aria-label={`Remove ${item.title}`}>Remove</button></article>)}</div> : <div className="browser-welcome glass-panel"><div className="welcome-emblem">{kind === "history" ? "◷" : "☆"}</div><h2>Nothing here yet</h2><p>{kind === "history" ? "Pages you read in SonsiSearch will show up here." : "Save a page from the Browser to find it here."}</p><Link className="action-button" href={kind === "history" ? "/browser" : "/"}>Explore the web</Link></div>}
  </main>;
}
