"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

type SavedSite = { title: string; url: string; visited?: number };
const emptySites: SavedSite[] = [];
let bookmarksRaw: string | null | undefined;
let bookmarksCache: SavedSite[] = [];

function getBookmarks() {
  const raw = localStorage.getItem("sonsisearch:bookmarks");
  if (raw !== bookmarksRaw) {
    bookmarksRaw = raw;
    try { bookmarksCache = raw ? (JSON.parse(raw) as SavedSite[]).slice(0, 4) : []; } catch { bookmarksCache = []; }
  }
  return bookmarksCache;
}

function getHost(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export function HomeBookmarks() {
  const sites = useSyncExternalStore((notify) => {
    window.addEventListener("sonsisearch:saved", notify);
    window.addEventListener("storage", notify);
    return () => { window.removeEventListener("sonsisearch:saved", notify); window.removeEventListener("storage", notify); };
  }, getBookmarks, () => emptySites);

  return <section className="recent-section home-bookmarks">
    <div className="section-heading"><div><span className="eyebrow">SAVED FOR LATER</span><h2>Bookmarks</h2></div><Link href="/bookmarks">View all <span>↗</span></Link></div>
    {sites.length ? <div className="site-grid">{sites.map((site) => {
      const host = getHost(site.url);
      return <a className="site-card glass-panel" href={`/browser?url=${encodeURIComponent(site.url)}`} key={site.url}><span className="site-glyph">{host[0]?.toUpperCase() || "☆"}</span><span className="site-copy"><strong>{site.title || host}</strong><small>{host}</small></span><span className="site-arrow">↗</span></a>;
    })}</div> : <Link className="bookmark-empty glass-panel" href="/bookmarks"><span className="bookmark-empty-icon">☆</span><span><strong>No bookmarks yet</strong><small>Save pages from the Browser and they’ll appear here.</small></span><span className="site-arrow">↗</span></Link>}
  </section>;
}
