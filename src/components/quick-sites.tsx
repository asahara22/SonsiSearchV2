"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { parseAddressOrSearch } from "@/lib/address";

type Site = { title: string; url: string };
const STORAGE_KEY = "sonsisearch:quick-sites";
const DEFAULT_SITES: Site[] = [
  { title: "YouTube", url: "https://www.youtube.com" },
  { title: "Discord", url: "https://discord.com/app" },
  { title: "Reddit", url: "https://www.reddit.com" },
  { title: "TikTok", url: "https://www.tiktok.com" },
  { title: "Spotify", url: "https://open.spotify.com" },
  { title: "GitHub", url: "https://github.com" },
];
const ADULT_SITES: Site[] = [
  { title: "pixiv", url: "https://www.pixiv.net" },
  { title: "FANZA", url: "https://www.fanze.jp" },
  { title: "DLsite", url: "https://www.dlsite.com" },
  { title: "Pornhub", url: "https://www.pornhub.com" },
  { title: "Fantia", url: "https://spotlight.fantia.jp/" },
];

function readSites(): Site[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (Array.isArray(value)) return value.filter((site) => site && typeof site.title === "string" && typeof site.url === "string").slice(0, 12);
  } catch { /* Use the starter list when saved data is unavailable. */ }
  return DEFAULT_SITES;
}

export function QuickSites() {
  const [sites, setSites] = useState<Site[]>(DEFAULT_SITES);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [adultEnabled, setAdultEnabled] = useState(false);

  useEffect(() => {
    setSites(readSites());
    const syncAdultMode = () => setAdultEnabled(localStorage.getItem("sonsisearch:r18") === "enabled");
    syncAdultMode();
    window.addEventListener("sonsisearch:r18", syncAdultMode);
    window.addEventListener("storage", syncAdultMode);
    return () => { window.removeEventListener("sonsisearch:r18", syncAdultMode); window.removeEventListener("storage", syncAdultMode); };
  }, []);

  function save(next: Site[]) {
    setSites(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  function addSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseAddressOrSearch(url);
    if (!title.trim() || parsed.kind !== "url" || sites.length >= 12) return;
    save([...sites, { title: title.trim().slice(0, 32), url: parsed.value }]);
    setTitle(""); setUrl("");
  }
  return <section className="quick-sites-section" aria-label="Quick links">
    <div className="section-heading"><div><span className="eyebrow">YOUR SHORTCUTS</span><h2>Quick sites</h2></div><button className="quick-edit" onClick={() => setEditing((value) => !value)}>{editing ? "Done" : "Edit"}</button></div>
    {editing && <form className="quick-site-form" onSubmit={addSite}><input aria-label="Site name" placeholder="Site name" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={32} /><input aria-label="Site URL" placeholder="example.com" value={url} onChange={(event) => setUrl(event.target.value)} /><button type="submit" disabled={sites.length >= 12}>Add site</button></form>}
    <div className="site-grid">{sites.map((site) => {
      const host = new URL(site.url).hostname.replace(/^www\./, "");
      return <div className="quick-site-wrap" key={site.url}><a className="site-card glass-panel" href={`/browser?url=${encodeURIComponent(site.url)}`}><span className="site-glyph">{site.title[0]?.toUpperCase()}</span><span className="site-copy"><strong>{site.title}</strong><small>{host}</small></span><span className="site-arrow">↗</span></a>{editing && <button className="quick-remove" aria-label={`Remove ${site.title}`} onClick={() => save(sites.filter((entry) => entry.url !== site.url))}>×</button>}</div>;
    })}</div>
    {adultEnabled && <section className="adult-sites adult-sites-enabled" aria-label="18+ sites">
      <div className="adult-sites-heading"><div><span className="adult-label">18+ · ADULT CONTENT</span><h3>R18 sites</h3></div><Link className="adult-toggle" href="/settings">{adultEnabled ? "R18 ON · Settings" : "Enable in Settings"}</Link></div>
      <div className="adult-sites-grid">{ADULT_SITES.map((site) => <button className="adult-site-button" key={site.url} onClick={() => { window.location.href = `/browser?url=${encodeURIComponent(site.url)}`; }}>{site.title}<span>↗</span></button>)}</div>
    </section>}
  </section>;
}
