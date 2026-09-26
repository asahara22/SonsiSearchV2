"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseAddressOrSearch } from "@/lib/address";
import { buildSearchUrl, getSearchEngine } from "@/lib/search-engine";

type SavedSite = { title: string; url: string; visited: number };
type DiagnosticCheck = { id: string; label: string; state: "pending" | "ok" | "warn" | "fail"; detail: string };
type DiagnosticStage = { state: "running" | "ok" | "failed"; detail: string; at: number };

export function BrowserShell({ initialUrl, proxyOrigin }: { initialUrl: string; proxyOrigin: string }) {
  const initial = parseAddressOrSearch(initialUrl);
  const [input, setInput] = useState(initial.kind === "url" ? initial.value : "");
  const [target, setTarget] = useState(initial.kind === "url" ? initial.value : "");
  const [error, setError] = useState(initial.kind === "invalid" ? "Credentials in a URL are not supported." : proxyOrigin ? "" : "Proxy service is not configured.");
  const [loading, setLoading] = useState(initial.kind === "url");
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  const [diagnosticChecks, setDiagnosticChecks] = useState<DiagnosticCheck[]>([]);
  const [diagnosticStages, setDiagnosticStages] = useState<Record<string, DiagnosticStage>>({});
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appPingResolver = useRef<((responded: boolean) => void) | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const router = useRouter();
  const proxy = proxyOrigin.replace(/\/$/, "");
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
    if (initialSearch && initialUrl) router.replace(`/browser?url=${encodeURIComponent(buildSearchUrl(initialSearch, getSearchEngine()))}`);
  }, [initialSearch, initialUrl, router]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== proxy) return;
      if (event.data?.type === "sonsisearch:ready") setFrameReady(true);
      if (event.data?.type === "sonsisearch:diagnostic" && typeof event.data.stage === "string") {
        const stage = event.data.stage as string;
        const state = event.data.state;
        if (["running", "ok", "failed"].includes(state)) {
          setDiagnosticStages((current) => ({ ...current, [stage]: {
            state, detail: typeof event.data.detail === "string" ? event.data.detail : "",
            at: typeof event.data.at === "number" ? event.data.at : Date.now(),
          } }));
        }
        if (stage === "halcyon-app" && state === "ok") appPingResolver.current?.(true);
      }
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
    if (parsed.kind === "search") { const url = buildSearchUrl(parsed.value, getSearchEngine()); setTarget(url); setInput(url); setLoading(true); router.push(`/browser?url=${encodeURIComponent(url)}`); return; }
    setTarget(parsed.value);
    setInput(parsed.value);
    setLoading(true);
    setError("");
    router.replace(`/browser?url=${encodeURIComponent(parsed.value)}`);
  }

  function updateDiagnostic(id: string, state: DiagnosticCheck["state"], detail: string) {
    setDiagnosticChecks((current) => current.map((check) => check.id === id ? { ...check, state, detail } : check));
  }

  async function runDiagnostics() {
    setDiagnosticsOpen(true);
    setDiagnosticsRunning(true);
    setCopyMessage("");
    setDiagnosticStages({});
    const initialChecks: DiagnosticCheck[] = [
      { id: "browser", label: "Browser capabilities", state: "pending", detail: "Checking secure context, Service Worker, and WebSocket support" },
      { id: "proxy", label: "Proxy service", state: "pending", detail: "Checking HTTPS endpoint" },
      { id: "embed", label: "Embed permission", state: "pending", detail: "Checking allowed frontend origin" },
      { id: "auth", label: "Proxy access gate", state: "pending", detail: "Checking whether authentication is required" },
      { id: "websocket", label: "Wisp WebSocket", state: "pending", detail: "Checking secure WebSocket handshake" },
      { id: "app", label: "Halcyon app in iframe", state: "pending", detail: "Waiting for embedded app response" },
    ];
    setDiagnosticChecks(initialChecks);
    const browserReady = window.isSecureContext && "serviceWorker" in navigator && typeof WebSocket !== "undefined";
    updateDiagnostic("browser", browserReady && navigator.onLine ? "ok" : "fail", !navigator.onLine
      ? "The browser reports that it is offline."
      : !window.isSecureContext
        ? "HTTPS is required for Service Workers and secure WebSockets."
        : !(("serviceWorker" in navigator) && typeof WebSocket !== "undefined")
          ? "This browser or filter disabled Service Worker or WebSocket support."
          : "HTTPS, Service Worker, and WebSocket APIs are available.");

    if (!proxy) {
      updateDiagnostic("proxy", "fail", "NEXT_PUBLIC_PROXY_URL is missing or invalid.");
      for (const id of ["embed", "auth", "websocket", "app"]) updateDiagnostic(id, "warn", "Skipped because the proxy URL is not configured.");
      setDiagnosticsRunning(false);
      return;
    }

    let probe: { embedAllowed: boolean; authenticationRequired: boolean } | null = null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(`${proxy}/.well-known/sonsisearch-diagnostics`, {
        method: "GET", cache: "no-store", credentials: "omit", signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const details = await response.json() as { embedAllowed: boolean; authenticationRequired: boolean };
      probe = details;
      updateDiagnostic("proxy", "ok", `HTTPS responded (${response.status}).`);
      updateDiagnostic("embed", details.embedAllowed ? "ok" : "fail", details.embedAllowed
        ? "This frontend origin is allowed by HALCYON_EMBED_ORIGINS."
        : "This frontend origin is missing from HALCYON_EMBED_ORIGINS in Render.");
      updateDiagnostic("auth", details.authenticationRequired ? "warn" : "ok", details.authenticationRequired
        ? "A passphrase is required. Unlock the proxy in this browser before embedding it."
        : "No passphrase gate is configured.");
    } catch (error) {
      const detail = error instanceof DOMException && error.name === "AbortError"
        ? "The proxy check timed out after 7 seconds. A network filter, DNS issue, or sleeping service may be blocking it."
        : "The HTTPS check failed. A network filter, CORS configuration, DNS issue, or sleeping service may be blocking it.";
      updateDiagnostic("proxy", "fail", detail);
      for (const id of ["embed", "auth"]) updateDiagnostic(id, "warn", "Could not inspect the proxy configuration.");
    } finally {
      clearTimeout(timeout);
    }

    const wispUrl = `${proxy.replace(/^https:/, "wss:").replace(/^http:/, "ws:")}/wisp/`;
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(wsTimeout);
          try { socket.close(); } catch { /* already closed */ }
          if (error) reject(error);
          else resolve();
        };
        const socket = new WebSocket(wispUrl, "wisp-v2");
        const wsTimeout = setTimeout(() => finish(new Error("timeout")), 7000);
        socket.addEventListener("open", () => finish());
        socket.addEventListener("error", () => finish(new Error("handshake failed")));
        socket.addEventListener("close", (event) => {
          if (!settled && event.code !== 1000) finish(new Error(`closed (${event.code})`));
        });
      });
      updateDiagnostic("websocket", "ok", "WSS handshake succeeded; this network allows the proxy tunnel.");
    } catch {
      updateDiagnostic("websocket", "fail", "WSS handshake failed. A network filter may block WebSockets, or the proxy rejected the connection.");
    }

    if (!target) {
      updateDiagnostic("app", "warn", "Open a URL in the Browser to check its embedded Halcyon frame.");
    } else if (!frameRef.current?.contentWindow) {
      updateDiagnostic("app", "fail", "The Halcyon iframe is not available on this page.");
    } else {
      const pingTimeout = setTimeout(() => appPingResolver.current?.(false), 5000);
      const responded = await new Promise<boolean>((resolve) => {
        const done = (value: boolean) => {
          if (appPingResolver.current === done) appPingResolver.current = null;
          clearTimeout(pingTimeout);
          resolve(value);
        };
        appPingResolver.current = done;
        send("sonsisearch:diagnose");
      });
      if (responded) {
        updateDiagnostic("app", "ok", "The embedded Halcyon app is responding.");
        if (probe?.authenticationRequired) updateDiagnostic("auth", "ok", "Passphrase gate is configured and this browser session is unlocked.");
      } else if (probe && !probe.embedAllowed) {
        updateDiagnostic("app", "fail", "The proxy does not allow this frontend origin; fix HALCYON_EMBED_ORIGINS.");
      } else if (probe?.authenticationRequired) {
        updateDiagnostic("app", "warn", "No app response. The passphrase gate may be showing inside the iframe; unlock the proxy in this browser and retry.");
      } else {
        updateDiagnostic("app", "fail", frameLoaded
          ? "The proxy page loaded, but its app script did not answer. A content filter may be blocking scripts."
          : "The proxy iframe did not finish loading. Check the proxy URL and network filter.");
      }
    }
    setDiagnosticsRunning(false);
  }

  function getDiagnosticReport() {
    const lines = [
      "SonsiSearch connection diagnostics",
      `Time: ${new Date().toISOString()}`,
      `Frontend: ${window.location.origin}`,
      `Proxy: ${proxy || "not configured"}`,
      `Online: ${navigator.onLine}; secure context: ${window.isSecureContext}; WebSocket: ${typeof WebSocket !== "undefined"}`,
      `Browser: ${navigator.userAgent}`,
      ...diagnosticChecks.map((check) => `${check.state.toUpperCase()} ${check.label}: ${check.detail}`),
      ...Object.entries(diagnosticStages).map(([stage, value]) => `${value.state.toUpperCase()} ${stage}: ${value.detail}`),
    ];
    return lines.join("\n");
  }

  async function copyDiagnosticReport() {
    try {
      await navigator.clipboard.writeText(getDiagnosticReport());
      setCopyMessage("Diagnostic report copied.");
    } catch {
      setCopyMessage("Copy was blocked. Select and copy the report below.");
    }
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
        {menuOpen && <div className="browser-menu glass-panel">{[["Home", "/"], ["History", "/history"], ["Bookmarks", "/bookmarks"]].map(([label, href]) => <a href={href} key={href} onClick={() => setMenuOpen(false)}>{label}</a>)}<button onClick={() => { setMenuOpen(false); void runDiagnostics(); }}>Connection diagnostics</button>{target && <button onClick={() => { window.open(target, "_blank", "noopener,noreferrer"); setMenuOpen(false); }}>Open original ↗</button>}</div>}
      </div>
    </div>
    <div className="browser-progress"><span className={loading ? "active" : ""} /></div>
      {target ? <div className="web-viewport"><div className="browser-wait" hidden={!loading}><span className="loading-orbit"/><span>Connecting securely…</span><button className="wait-diagnostics" onClick={() => void runDiagnostics()}>Diagnose</button></div>{proxy && <iframe ref={frameRef} className="browser-frame" title="Web page" src={`${proxy}/proxy`} onLoad={() => setFrameLoaded(true)} allow="clipboard-read; clipboard-write; fullscreen; autoplay; encrypted-media; picture-in-picture" referrerPolicy="no-referrer" />}{error && <ConnectionError error={error} target={target} retry={() => { setError(""); setLoading(true); startLoadTimeout(); send("sonsisearch:navigate", target); }} back={() => router.back()} diagnose={() => void runDiagnostics()} />}</div> : error ? <ConnectionError error={error} back={() => router.back()} diagnose={() => void runDiagnostics()} /> : <section className="browser-welcome"><div className="welcome-emblem">◉</div><span className="eyebrow">SONSIPROXY · READY</span><h1>Where to next?</h1><p>Enter a web address or search the open web.</p><button className="action-button" onClick={() => router.push("/")}>⌂ <span>Go to search</span></button><button className="action-button" onClick={() => void runDiagnostics()}>ⓘ <span>Connection diagnostics</span></button></section>}
    {diagnosticsOpen && <DiagnosticsPanel checks={diagnosticChecks} stages={diagnosticStages} running={diagnosticsRunning} copyMessage={copyMessage} report={getDiagnosticReport()} rerun={() => void runDiagnostics()} copy={() => void copyDiagnosticReport()} close={() => setDiagnosticsOpen(false)} />}
  </main>;
}

function ConnectionError({ error, target, retry, back, diagnose }: { error: string; target?: string; retry?: () => void; back: () => void; diagnose: () => void }) {
  return <div className="connection-overlay"><section className="connection-error glass-panel"><span className="error-orb">!</span><span className="eyebrow">CONNECTION INTERRUPTED</span><h1>Unable to load this page</h1><p>{error}</p><div className="error-actions">{retry && <button className="action-button primary-action" onClick={retry}>Retry</button>}<button className="action-button" onClick={diagnose}>Run diagnostics</button><button className="action-button" onClick={back}>Back</button>{target && <button className="action-button" onClick={() => window.open(target, "_blank", "noopener,noreferrer")}>Open original ↗</button>}</div></section></div>;
}

function DiagnosticsPanel({ checks, stages, running, copyMessage, report, rerun, copy, close }: {
  checks: DiagnosticCheck[];
  stages: Record<string, DiagnosticStage>;
  running: boolean;
  copyMessage: string;
  report: string;
  rerun: () => void;
  copy: () => void;
  close: () => void;
}) {
  const stageLabels: Record<string, string> = {
    "halcyon-app": "Halcyon interface",
    runtime: "Proxy runtime",
    "service-worker": "Service Worker",
    "scramjet-assets": "Scramjet assets",
    "controller-assets": "Scramjet controller assets",
    "transport-assets": "Transport assets",
    controller: "Scramjet initialization",
    navigation: "Target navigation",
  };
  const stateLabel = (state: DiagnosticCheck["state"] | DiagnosticStage["state"]) => ({
    pending: "Checking", running: "Running", ok: "Passed", warn: "Check", fail: "Failed", failed: "Failed",
  }[state]);
  return <div className="diagnostics-overlay" role="presentation">
    <section className="diagnostics-panel glass-panel" role="dialog" aria-modal="true" aria-labelledby="diagnostics-title">
      <header className="diagnostics-header"><div><span className="eyebrow">NETWORK TROUBLESHOOTING</span><h2 id="diagnostics-title">Connection diagnostics</h2></div><button className="browser-control" onClick={close} aria-label="Close diagnostics">×</button></header>
      <p className="diagnostics-intro">Checks the proxy connection, embed settings, passphrase gate, and Wisp WebSocket. It does not include the page URL or passphrase in the report.</p>
      <div className="diagnostics-list">
        {checks.map((check) => <DiagnosticRow key={check.id} label={check.label} state={check.state} stateLabel={stateLabel(check.state)} detail={check.detail} />)}
        {Object.entries(stages).map(([stage, value]) => <DiagnosticRow key={stage} label={stageLabels[stage] || stage} state={value.state} stateLabel={stateLabel(value.state)} detail={value.detail} />)}
      </div>
      {checks.length === 0 && <p className="diagnostics-empty">Run the checks to see where the connection is stopping.</p>}
      <details className="diagnostics-report"><summary>Diagnostic report</summary><textarea aria-label="Diagnostic report" readOnly value={report} rows={Math.min(12, Math.max(5, checks.length + Object.keys(stages).length + 4))} /></details>
      <p className="diagnostics-copy-status" aria-live="polite">{copyMessage || (running ? "Tests are still running…" : "")}</p>
      <div className="diagnostics-actions"><button className="action-button" onClick={close}>Close</button><button className="action-button" onClick={copy}>Copy report</button><button className="action-button primary-action" onClick={rerun} disabled={running}>{running ? "Testing…" : "Run again"}</button></div>
    </section>
  </div>;
}

function DiagnosticRow({ label, state, stateLabel, detail }: { label: string; state: DiagnosticCheck["state"] | DiagnosticStage["state"]; stateLabel: string; detail: string }) {
  return <div className={`diagnostic-row diagnostic-${state}`}><span className="diagnostic-indicator" aria-hidden="true">{state === "ok" ? "✓" : state === "pending" || state === "running" ? "·" : "!"}</span><div className="diagnostic-copy"><div className="diagnostic-heading"><strong>{label}</strong><span>{stateLabel}</span></div><p>{detail}</p></div></div>;
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
