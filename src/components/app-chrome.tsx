"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const links = [["⌂", "Home", "/"], ["⌕", "Search", "/search"], ["◫", "Browser", "/browser"], ["◷", "History", "/history"], ["☆", "Bookmarks", "/bookmarks"], ["⚙", "Settings", "/settings"]];

export function AppChrome({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const theme = localStorage.getItem("sonsisearch:theme") || "dark";
    document.documentElement.dataset.theme = theme;
    const color = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (color) color.content = theme === "light" ? "#edf2fa" : "#0b1020";
  }, []);
  return <div className="app-frame">
    <header className="app-header">
      <button className="icon-button menu-trigger" aria-label="Open navigation" onClick={() => setOpen(true)}>☰</button>
      <Link prefetch={false} className="brand" href="/"><span className="brand-mark">◉</span><span>Sonsi<span className="brand-accent">Search</span> V2</span></Link>
      <Link prefetch={false} className="header-browser" href="/browser">Browser <span>↗</span></Link>
    </header>
    <div className="app-content">{children}</div>
    {open && <div className="drawer-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <nav className="nav-drawer" aria-label="Main navigation">
        <div className="drawer-head"><span>Navigate</span><button className="icon-button" aria-label="Close navigation" onClick={() => setOpen(false)}>×</button></div>
        {links.map(([icon, label, href]) => <Link prefetch={false} className="drawer-link" href={href} key={href} onClick={() => setOpen(false)}><span>{icon}</span>{label}</Link>)}
      </nav>
    </div>}
  </div>;
}
