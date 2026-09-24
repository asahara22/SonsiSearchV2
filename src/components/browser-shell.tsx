"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseAddressOrSearch } from "@/lib/address";

type SavedSite = { title: string; url: string; visited: number };

export function BrowserShell({ initialUrl }: { initialUrl: string }) {
  const initial = parseAddressOrSearch(initialUrl);
  const [input, setInput] = useState(initial.kind === "url" ? initial.value : "");
  const [target, setTarget] = useState(initial.kind === "url" ? initial.value : "");
  const [error, setError] = useState(initial.kind === "invalid" ? "Credentials in a URL are not supported." : getProxyUrl() ? "" : "Proxy service is not configured. Set NEXT_PUBLIC_PROXY_URL to the Halcyon HTTPS origin.");
  const [loading, setLoading] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const router = useRouter();
  const proxy = getProxyUrl();
  const send = useCallback((type: string, url?: string) => {
    frameRef.current?.contentWindow?.postMessage({ type, ...(url ? { url } : {}) }, proxy);
  }, [proxy]);
  const startLoadTimeout = useCallback(() => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    loadTimer.current = setTimeout(() => {
      setLoading(false);
      setError("The proxy did not finish loading this page. Retry the connection or open the original site.");
    }, 30000);
  }, []);
  const initialSearch = initial.kind === "search" ? initial.value : "";

  useEffect(() => {
    if (initialSearch && initialUrl) router.replace(`/search?q=${encodeURIComponent(initialSearch)}`);
  }, [initialSearch, initialUrl, router]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== proxy) return;
      if (event.data?.type === "sonsisearch:ready") setFrameReady(true);
      if (event.data?.type === "sonsisearch:loading") setLoading(Boolean(event.data.loading));
      if (event.data?.type === "sonsisearch:loaded") {
        if (loadTimer.current) clearTimeout(loadTimer.current);
        loadTimer.current = null;
        setLoading(false); setError("");
      }
      if (event.data?.type === "sonsisearch:error") setError("Unable to load this page. Check the connection and try again.");
      if (event.data?.type === "sonsisearch:location" && typeof event.data.url === "string") {
        const url = safeHttpUrl(event.data.url);
        if (!url) return;
        setTarget(url);
        setInput(url);
        setError("");
        rememberVisit(url);
        const route = `/browser?url=${encodeURIComponent(url)}`;
        if (`${window.location.pathname}${window.location.search}` !== route) router.replace(route);
        setIsBookmarked(readBookmarks().some((item) => item.url === url));
      }
    };
    window.addEventListener("message", onMessage);
    return () => { window.removeEventListener("message", onMessage); if (loadTimer.current) clearTimeout(loadTimer.current); };
  }, [proxy, router]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        setLoading(true); startLoadTimeout();
        send("sonsisearch:reload");
      } else if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault(); send("sonsisearch:back");
      } else if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault(); send("sonsisearch:forward");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send, startLoadTimeout]);

  useEffect(() => {
    if (frameReady && target) {
      startLoadTimeout();
      send("sonsisearch:navigate", target);
    }
  }, [frameReady, target, send, startLoadTimeout]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const parsed = parseAddressOrSearch(input);
    if (parsed.kind === "invalid") { setError("Credentials in a URL are not supported."); return; }
    if (parsed.kind === "search") { router.push(`/search?q=${encodeURIComponent(parsed.value)}`); return; }
    setTarget(parsed.value);
    setInput(parsed.value);
    setLoading(true);
    setError("");
    router.replace(`/browser?url=${encodeURIComponent(parsed.value)}`);
  }

  function toggleBookmark() {
    if (!target) return;
    const current = readBookmarks();
    if (current.some((item) => item.url === target)) {
      localStorage.setItem("sonsisearch:bookmarks", JSON.stringify(current.filter((item) => item.url !== target)));
      setIsBookmarked(false);
    } else {
      current.unshift({ title: hostOf(target), url: target, visited: Date.now() });
      localStorage.setItem("sonsisearch:bookmarks", JSON.stringify(current.slice(0, 100)));
      setIsBookmarked(true);
    }
    window.dispatchEvent(new Event("sonsisearch:saved"));
  }

  const host = target ? hostOf(target) : "Search or enter a URL";
  return <main className="browser-page page-enter">
    <div className="browser-toolbar glass-panel">
      <div className="browser-controls">
        <button className="browser-control" type="button" title="Back (Alt + ←)" aria-label="Back" onClick={() => send("sonsisearch:back")}>←</button>
        <button className="browser-control" type="button" title="Forward (Alt + →)" aria-label="Forward" onClick={() => send("sonsisearch:forward")}>→</button>
        <button className={`browser-control${loading ? " is-loading" : ""}`} type="button" title="Reload (Ctrl + R)" aria-label="Reload" onClick={() => { setLoading(true); startLoadTimeout(); send("sonsisearch:reload"); }}>↻</button>
      </div>
      <form className={`address-form${isFocused ? " focused" : ""}`} onSubmit={submit}>
        <span className="address-lock" aria-label={target.startsWith("https:") ? "Secure connection" : "Web address"}>{target.startsWith("https:") ? "⌑" : "⌕"}</span>
        <input ref={inputRef} aria-label="URL or search" placeholder="Search or enter a URL" value={input} onChange={(event) => setInput(event.target.value)} onFocus={() => setIsFocused(true)} onBlur={() => setIsFocused(false)} />
        {target && <span className="address-domain">{host}</span>}
        <button type="submit" className="address-go" aria-label="Go">→</button>
      </form>
      <button className={`browser-control bookmark-control${isBookmarked ? " saved" : ""}`} title={isBookmarked ? "Remove bookmark" : "Bookmark this page"} aria-label={isBookmarked ? "Remove bookmark" : "Bookmark this page"} onClick={toggleBookmark}>☆</button>
      <div className="browser-menu-wrap"><button className="browser-control" aria-label="Browser menu" title="Menu" onClick={() => setMenuOpen((value) => !value)}>···</button>
        {menuOpen && <div className="browser-menu glass-panel">{[["Home", "/"], ["History", "/history"], ["Bookmarks", "/bookmarks"]].map(([label, href]) => <a href={href} key={href} onClick={() => setMenuOpen(false)}>{label}</a>)}{target && <button onClick={() => { window.open(target, "_blank", "noopener,noreferrer"); setMenuOpen(false); }}>Open original ↗</button>}</div>}
      </div>
    </div>
    <div className="browser-progress"><span className={loading ? "active" : ""} /></div>
      {target ? <div className="web-viewport"><div className="browser-wait" hidden={!loading}><span className="loading-orbit"/><span>Connecting securely…</span></div>{proxy && <iframe ref={frameRef} className="browser-frame" title="Web page" src={proxy} allow="clipboard-read; clipboard-write; fullscreen; autoplay; encrypted-media; picture-in-picture" referrerPolicy="no-referrer" />}{error && <ConnectionError error={error} target={target} retry={() => { setError(""); setLoading(true); startLoadTimeout(); send("sonsisearch:navigate", target); }} back={() => router.back()} />}</div> : error ? <ConnectionError error={error} back={() => router.back()} /> : <section className="browser-welcome"><div className="welcome-emblem">◉</div><span className="eyebrow">SONSIPROXY · READY</span><h1>Where to next?</h1><p>Enter a web address or search the open web.</p><button className="action-button" onClick={() => router.push("/")}>⌂ <span>Go to search</span></button></section>}
  </main>;
}

function getProxyUrl() {
  const configured = process.env.NEXT_PUBLIC_PROXY_URL?.trim();
  if (!configured) return "";
  try {
    const url = new URL(configured);
    if (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return url.origin;
  } catch { /* invalid configuration */ }
  return "";
}

function ConnectionError({ error, target, retry, back }: { error: string; target?: string; retry?: () => void; back: () => void }) {
  return <div className="connection-overlay"><section className="connection-error glass-panel"><span className="error-orb">!</span><span className="eyebrow">CONNECTION INTERRUPTED</span><h1>Unable to load this page</h1><p>{error}</p><div className="error-actions">{retry && <button className="action-button primary-action" onClick={retry}>Retry</button>}<button className="action-button" onClick={back}>Back</button>{target && <button className="action-button" onClick={() => window.open(target, "_blank", "noopener,noreferrer")}>Open original ↗</button>}</div></section></div>;
}

function safeHttpUrl(value: string): string | null {
  try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? url.href : null; } catch { return null; }
}

function hostOf(value: string) { try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return value; } }
function readBookmarks(): SavedSite[] { try { return JSON.parse(localStorage.getItem("sonsisearch:bookmarks") || "[]"); } catch { return []; } }
function rememberVisit(url: string) {
  const history: SavedSite[] = (() => { try { return JSON.parse(localStorage.getItem("sonsisearch:history") || "[]"); } catch { return []; } })();
  localStorage.setItem("sonsisearch:history", JSON.stringify([{ title: hostOf(url), url, visited: Date.now() }, ...history.filter((entry) => entry.url !== url)].slice(0, 100)));
  window.dispatchEvent(new Event("sonsisearch:saved"));
}
