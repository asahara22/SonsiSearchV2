"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

type SavedSite = { title: string; url: string; visited?: number };
const emptySites: SavedSite[] = [];
const popular: SavedSite[] = [
  { title: "YouTube", url: "https://www.youtube.com" },
  { title: "Discord", url: "https://discord.com/app" },
  { title: "Reddit", url: "https://www.reddit.com" },
  { title: "TikTok", url: "https://www.tiktok.com" },
  { title: "Spotify", url: "https://open.spotify.com" },
  { title: "GitHub", url: "https://github.com" },
];
let historyRaw: string | null | undefined;
let historyCache: SavedSite[] = [];
function getRecentSites() {
  const raw = localStorage.getItem("sonsisearch:history");
  if (raw !== historyRaw) {
    historyRaw = raw;
    try { historyCache = raw ? JSON.parse(raw).slice(0, 4) as SavedSite[] : []; } catch { historyCache = []; }
  }
  return historyCache;
}

export function RecentSites() {
  const sites = useSyncExternalStore((notify) => {
    window.addEventListener("sonsisearch:saved", notify); window.addEventListener("storage", notify);
    return () => { window.removeEventListener("sonsisearch:saved", notify); window.removeEventListener("storage", notify); };
  }, getRecentSites, () => emptySites);
  const shown = sites.length ? sites : popular;
  return <section className="recent-section">
    <div className="section-heading"><div><span className="eyebrow">{sites.length ? "PICK UP WHERE YOU LEFT OFF" : "A FEW PLACES TO START"}</span><h2>{sites.length ? "Recent" : "Explore"}</h2></div><Link href={sites.length ? "/history" : "/bookmarks"}>{sites.length ? "View history" : "Your bookmarks"} <span>↗</span></Link></div>
    <div className="site-grid">{shown.map((site) => {
      const host = new URL(site.url).hostname.replace(/^www\./, "");
      return <Link prefetch={false} className="site-card glass-panel" href={`/browser?url=${encodeURIComponent(site.url)}`} key={site.url}><span className="site-glyph">{host[0].toUpperCase()}</span><span className="site-copy"><strong>{site.title || host}</strong><small>{host}</small></span><span className="site-arrow">↗</span></Link>;
    })}</div>
  </section>;
}
