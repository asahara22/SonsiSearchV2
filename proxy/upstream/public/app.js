// Halcyon UI controller.
(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const embedOrigins = [...new Set([...(Array.isArray(window.HALCYON_EMBED_ORIGINS) ? window.HALCYON_EMBED_ORIGINS : []), location.origin])];
  const notifyParent = (message) => {
    if (window.parent === window) return;
    for (const origin of embedOrigins) window.parent.postMessage(message, origin);
  };
  const reportDiagnostic = (stage, state, detail = "") => notifyParent({
    type: "sonsisearch:diagnostic",
    stage,
    state,
    detail: String(detail).replace(/https?:\/\/[^\s"'<>]+/g, "[URL]").slice(0, 180),
    at: Date.now(),
  });

  const store = {
    get: (k, d) => localStorage.getItem("halcyon:" + k) ?? d,
    set: (k, v) => localStorage.setItem("halcyon:" + k, v),
    del: (k) => localStorage.removeItem("halcyon:" + k),
  };
  const transportAtStartup = localStorage.getItem("halcyon:transport") === "bare" ? "bare" : "wisp";

  // Tiny transient toast (inline-styled so it needs no CSS).
  let toastEl = null, toastT = 0;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.style.cssText =
        "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;" +
        "padding:10px 16px;border-radius:12px;font:600 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
        "color:#0a1a14;background:linear-gradient(118deg,#1fd1a3,#ffd27a);box-shadow:0 10px 30px rgba(0,0,0,.4);" +
        "opacity:0;transition:opacity .18s ease;pointer-events:none";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = "1";
    clearTimeout(toastT);
    toastT = setTimeout(() => (toastEl.style.opacity = "0"), 1600);
  }

  // ---- Shortcuts data ----
  const SITES = [
    { name: "YouTube", url: "https://www.youtube.com", color: "#ff0033", label: "YT" },
    { name: "Discord", url: "https://discord.com/app", color: "#5865f2", label: "D" },
    { name: "Reddit", url: "https://www.reddit.com", color: "#ff4500", label: "R" },
    { name: "TikTok", url: "https://www.tiktok.com", color: "#111", label: "T" },
    { name: "Spotify", url: "https://open.spotify.com", color: "#1db954", label: "S" },
    { name: "Twitch", url: "https://www.twitch.tv", color: "#9146ff", label: "Tv" },
    { name: "GitHub", url: "https://github.com", color: "#24292e", label: "Gh" },
    { name: "Wikipedia", url: "https://en.wikipedia.org", color: "#636466", label: "W" },
    { name: "Google", url: "https://www.google.com", color: "#4285f4", label: "G" },
    { name: "Gmail", url: "https://mail.google.com", color: "#ea4335", label: "M" },
    { name: "Instagram", url: "https://www.instagram.com", color: "#e1306c", label: "Ig" },
    { name: "X", url: "https://x.com", color: "#000", label: "X" },
    { name: "Netflix", url: "https://www.netflix.com", color: "#e50914", label: "N" },
    { name: "Amazon", url: "https://www.amazon.com", color: "#ff9900", label: "A" },
    { name: "Pinterest", url: "https://www.pinterest.com", color: "#e60023", label: "P" },
    { name: "SoundCloud", url: "https://soundcloud.com", color: "#ff5500", label: "Sc" },
  ];
  const QUICK = ["YouTube", "Discord", "Reddit", "TikTok", "Spotify", "GitHub"];

  // ---- Navigation between views ----
  function show(view) {
    $$(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === view));
    const activeNav = ["proxy", "results"].includes(view) ? "home" : view;
    $$(".nav-btn[data-nav]").forEach((b) =>
      b.classList.toggle("active", b.dataset.nav === activeNav)
    );
  }
  $$("[data-nav]").forEach((el) =>
    el.addEventListener("click", () => show(el.dataset.nav))
  );

  // ---- Render shortcuts ----
  const tile = (s, cls) => {
    const el = document.createElement("button");
    el.className = cls;
    el.style.setProperty("--glow", s.color);
    el.innerHTML =
      cls === "ql"
        ? `<span class="ico" style="background:${s.color}">${s.label}</span>${s.name}`
        : `<span class="tile" style="background:${s.color}">${s.label}</span><span class="card-name">${s.name}</span>`;
    el.addEventListener("click", () => launch(s.url));
    return el;
  };
  const qlWrap = $("#quicklinks");
  QUICK.forEach((n) => qlWrap.appendChild(tile(SITES.find((s) => s.name === n), "ql")));
  const grid = $("#apps-grid");
  SITES.forEach((s) => grid.appendChild(tile(s, "card")));

  // ---- Proxy tabs + launch flow ----
  const loader = $("#frame-loader");
  const tbInput = $("#tb-input");
  const tabstrip = $("#tabstrip");
  Halcyon.initTabs($("#frames"));

  const diagnosticStages = { ...(window.HALCYON_DIAGNOSTIC_STAGES || {}) };
  function renderDiagnostics() {
    const list = $("#diag-results"); if (!list) return;
    list.replaceChildren();
    const entries = Object.entries(diagnosticStages);
    for (const [stage, info] of entries) {
      const row = document.createElement("div"); row.className = "diagnostic-item";
      row.dataset.state = info.state === "failed" ? "fail" : info.state;
      const mark = document.createElement("span"); mark.className = "diagnostic-mark"; mark.textContent = info.state === "ok" ? "✓" : ["failed", "warn"].includes(info.state) ? "!" : "…";
      const copy = document.createElement("div");
      const name = document.createElement("strong"); name.textContent = stage;
      const detail = document.createElement("p"); detail.textContent = info.detail || info.state;
      copy.append(name, detail); row.append(mark, copy); list.appendChild(row);
    }
    $("#diag-report").value = entries.map(([stage, info]) => `${info.state.toUpperCase()} ${stage}: ${info.detail || ""}`).join("\n");
  }
  window.addEventListener("halcyon:diagnostic", (event) => {
    const { stage, state, detail = "" } = event.detail || {};
    if (!stage || !state) return;
    diagnosticStages[stage] = { state, detail: String(detail).replace(/https?:\/\/[^\s"'<>]+/g, "[URL]").slice(0, 180) };
    renderDiagnostics();
  });
  function setDiagnostic(stage, state, detail) {
    diagnosticStages[stage] = { state, detail };
    renderDiagnostics();
  }
  async function runDiagnostics() {
    show("diagnostics");
    $("#diag-summary").textContent = "端末とProxyへの接続を確認しています…";
    setDiagnostic("secure-context", window.isSecureContext ? "ok" : "failed", window.isSecureContext ? "HTTPSで接続しています" : "HTTPS接続が必要です");
    setDiagnostic("browser-online", navigator.onLine ? "ok" : "failed", navigator.onLine ? "ネットワーク接続あり" : "端末がオフラインです");
    setDiagnostic("service-worker-api", "serviceWorker" in navigator ? "ok" : "failed", "Service Worker API");
    setDiagnostic("websocket-api", "WebSocket" in window ? "ok" : "failed", "WebSocket API");
    try {
      const response = await fetch("/.well-known/sonsisearch-diagnostics", { cache: "no-store" });
      const info = await response.json();
      setDiagnostic("proxy-http", response.ok ? "ok" : "failed", response.ok ? "同じRenderサービスに到達しました" : `HTTP ${response.status}`);
      const authOk = !info.authenticationRequired || info.authenticated;
      setDiagnostic("proxy-auth", authOk ? "ok" : "failed", info.authenticationRequired ? authOk ? "ログイン済みです" : "ログインセッションがありません。いったんロック解除して再確認してください" : "パスワード保護は無効です");
      setDiagnostic("search-config", "ok", "検索サイトはSonsiSearchの設定画面で選択できます");
      if (!authOk) {
        setDiagnostic("wisp-websocket", "failed", "Proxyの認証を確認できません。再ログイン後にもう一度診断してください");
        $("#diag-summary").textContent = "ログイン状態を確認できません。まずロック解除して再確認してください。";
        return renderDiagnostics();
      }
    } catch { setDiagnostic("proxy-http", "failed", "Proxyへ接続できません。端末のフィルターやネットワーク設定を確認してください"); }
    const transportMode = store.get("transport", "wisp");
    if (transportMode === "bare") {
      setDiagnostic("transport-mode", "ok", "Bare HTTP方式を選択中。通常のページ通信ではWispを使いません");
      try {
        const response = await fetch("/bare/", { cache: "no-store", signal: AbortSignal.timeout(8000) });
        const manifest = response.ok ? await response.json() : null;
        const available = Boolean(manifest?.versions?.includes("v3"));
        setDiagnostic("bare-http", available ? "ok" : "failed", available ? "Bare ServerへHTTPSで接続できました" : `Bare Serverが利用できません (HTTP ${response.status})。RenderのHALCYON_PASSWORD設定を確認してください`);
        setDiagnostic("wisp-websocket", "ok", "Bare方式では通常のページ通信にWispは不要です");
        if (available) {
          try {
            const result = await window.Halcyon.probeBareEgress();
            setDiagnostic("bare-egress", result.status >= 200 && result.status < 400 ? "ok" : "failed", result.status >= 200 && result.status < 400 ? "Bare経由で外部HTTPSサイトを取得できました" : `Bare経由の外部HTTPS取得がHTTP ${result.status}で失敗しました`);
          } catch (error) {
            const status = Number(error?.status);
            const body = error?.body && typeof error.body === "object" ? error.body : {};
            const stack = typeof body.stack === "string" ? body.stack : "";
            const networkCode = ["EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "CERT_", "TLS", "SSL"].find((code) => stack.toUpperCase().includes(code));
            const reason = String(body.code || networkCode || body.id || "network_error").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 48);
            const detail = status
              ? `Bare Serverは応答しましたが外部HTTPS取得に失敗しました (HTTP ${status}, ${reason})。DNS/接続/TLSを確認してください`
              : `Bare endpointには届きましたが外部HTTPS取得に失敗しました (${reason})。Renderのログと外向き通信を確認してください`;
            setDiagnostic("bare-egress", "failed", detail);
          }
        }
      } catch { setDiagnostic("bare-http", "failed", "Bare HTTP接続に失敗しました。端末フィルターやRender側のBare設定を確認してください"); }
    } else {
      setDiagnostic("transport-mode", "ok", "Wisp方式を選択中。閲覧内容のTLSはブラウザ内で処理します");
      let wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/wisp/`;
      const savedWispUrl = localStorage.getItem("halcyon:wisp");
      if (savedWispUrl) {
        try {
          const configured = new URL(savedWispUrl);
          if (["ws:", "wss:"].includes(configured.protocol)) wsUrl = configured.href;
        } catch { /* The runtime will report an invalid saved Wisp URL. */ }
      }
      try {
        const wsResult = await new Promise((resolve) => {
          let settled = false; const finish = (ok, detail) => { if (settled) return; settled = true; clearTimeout(timer); try { socket.close(); } catch {} resolve({ ok, detail }); };
          const timer = setTimeout(() => finish(false, "Wisp WebSocketが5秒以内に応答しません（端末フィルターが原因の可能性）"), 5000);
          let socket;
          try { socket = new WebSocket(wsUrl, "wisp-v2"); } catch { return finish(false, "WebSocketを開始できません"); }
          socket.addEventListener("open", () => finish(true, "Wisp WebSocketに接続できました"), { once: true });
          socket.addEventListener("error", () => finish(false, "Wisp接続を確立できません。端末フィルター、ネットワーク、Render側の応答のいずれかを確認してください"), { once: true });
        });
        setDiagnostic("wisp-websocket", wsResult.ok ? "ok" : "failed", wsResult.detail);
      } catch { setDiagnostic("wisp-websocket", "failed", "Wisp WebSocketの確認に失敗しました"); }
    }
    if (window.Halcyon) setDiagnostic("halcyon-runtime", "ok", "Scramjet / Halcyon runtimeを読み込み済みです");
    const failed = Object.values(diagnosticStages).filter((item) => item.state === "failed").length;
    $("#diag-summary").textContent = failed ? `${failed}項目で問題を検出しました。結果を端末管理者に共有してください。` : "基本接続を確認しました。ページ読込中の場合はService Worker / runtimeの項目も確認してください。";
    renderDiagnostics();
  }
  $("#diag-run")?.addEventListener("click", runDiagnostics);
  $("#loader-diagnose")?.addEventListener("click", runDiagnostics);
  $("#diag-copy")?.addEventListener("click", async () => {
    const report = $("#diag-report").value;
    try { await navigator.clipboard.writeText(report); toast("診断レポートをコピーしました"); }
    catch { $("#diag-report").focus(); $("#diag-report").select(); toast("レポートを選択しました。コピーしてください"); }
  });
  $$('[data-nav="diagnostics"]').forEach((el) => el.addEventListener("click", () => runDiagnostics()));
  renderDiagnostics();

  let lastActiveUrl = "";

  // Render the tab strip and drive the address bar + loader from tab state.
  Halcyon.onTabs((state) => {
    const active = state.tabs.find((t) => t.active) || null;
    lastActiveUrl = active?.url || "";
    notifyParent({ type: "sonsisearch:loading", loading: Boolean(active?.loading) });
    if (active?.url && !active.loading) notifyParent({ type: "sonsisearch:loaded", url: active.url });
    if (active?.url) notifyParent({ type: "sonsisearch:location", url: active.url });
    if (active && document.activeElement !== tbInput) tbInput.value = active.url || "";
    loader.classList.toggle("hidden", !(active && active.loading));

    tabstrip.style.display = state.tabs.length ? "" : "none";
    tabstrip.innerHTML = "";
    for (const t of state.tabs) {
      const chip = document.createElement("div");
      chip.className = "tab" + (t.active ? " active" : "");
      chip.title = t.url || "New tab";
      const title = document.createElement("span");
      title.className = "t-title";
      title.textContent = t.title || "New Tab";
      const close = document.createElement("button");
      close.className = "t-close";
      close.type = "button";
      close.innerHTML = "&times;";
      close.title = "Close tab";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        Halcyon.closeTab(t.id);
        if (!Halcyon.tabsState().tabs.length) show("home");
      });
      chip.append(title, close);
      chip.addEventListener("click", () => {
        Halcyon.switchTab(t.id);
        show(t.url ? "proxy" : "home");
      });
      tabstrip.appendChild(chip);
    }
    const plus = document.createElement("button");
    plus.className = "tab-new";
    plus.type = "button";
    plus.innerHTML = "+";
    plus.title = "New tab";
    plus.addEventListener("click", () => {
      Halcyon.newTab();
      show("home");
    });
    tabstrip.appendChild(plus);
  });

  // Navigate the active tab (creating one if none exist).
  async function launch(input) {
    if (!input) return;
    show("proxy");
    notifyParent({ type: "sonsisearch:loading", loading: true });
    loader.classList.remove("hidden");
    tbInput.value = Halcyon.normalizeInput(input) || input;
    try {
      await Halcyon.go(input);
    } catch (err) {
      console.error(err);
      reportDiagnostic("navigation", "failed", err?.message || "Navigation failed");
      loader.classList.add("hidden");
      notifyParent({ type: "sonsisearch:error" });
      if (window.parent === window) toast("接続を開始できません。Diagnosticsから原因を確認してください。");
    }
  }

  function isWebAddress(value) {
    const text = value.trim();
    if (/^https?:\/\//i.test(text)) return true;
    return /^[\w-]+(?:\.[\w-]+)+(?:[:/][^\s]*)?$/i.test(text);
  }

  async function searchWeb(query) {
    const urls = {
      duckduckgo: "https://duckduckgo.com/?q=",
      startpage: "https://www.startpage.com/sp/search?query=",
      brave: "https://search.brave.com/search?q=",
      yahoo: "https://search.yahoo.com/search?p=",
    };
    let engine = "duckduckgo";
    try {
      const saved = localStorage.getItem("sonsisearch:search-engine");
      if (saved && Object.prototype.hasOwnProperty.call(urls, saved)) engine = saved;
    } catch { /* Use DuckDuckGo when browser storage is unavailable. */ }
    return launch(urls[engine] + encodeURIComponent(query.trim()));
  }

  function navigateOrSearch(value) {
    const input = value.trim(); if (!input) return;
    if (isWebAddress(input)) {
      try {
        const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
        if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return launch(url.href);
      } catch { /* Treat malformed input as a search. */ }
    }
    return searchWeb(input);
  }

  // Search bar on home
  $("#search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    navigateOrSearch($("#search-input").value);
    $("#search-input").value = "";
  });

  // Proxy top bar
  $("#tb-form").addEventListener("submit", (e) => {
    e.preventDefault();
    navigateOrSearch(tbInput.value);
  });
  $("#tb-back").addEventListener("click", () => Halcyon.back());
  $("#tb-forward").addEventListener("click", () => Halcyon.forward());
  $("#tb-reload").addEventListener("click", () => Halcyon.reload());
  $("#tb-home").addEventListener("click", () => show("home"));
  $("#tb-newtab").addEventListener("click", () => {
    if (lastActiveUrl) window.open(lastActiveUrl, "_blank");
  });
  // "Behind the overlay" — dismiss modal overlays + restore scroll on demand.
  $("#tb-overlay")?.addEventListener("click", () => {
    const n = Halcyon.removeOverlay();
    toast(n > 0 ? `Removed ${n} overlay${n > 1 ? "s" : ""}` : "Scroll unlocked — no overlay found");
  });

  // SonsiSearch's outer browser chrome controls this embedded Halcyon window.
  // Require the configured parent origin and the actual parent window; messages
  // can navigate only through Halcyon's own guarded Scramjet transport.
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || !embedOrigins.includes(event.origin)) return;
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "sonsisearch:diagnose") {
      reportDiagnostic("halcyon-app", "ok", "Embedded app is responding");
      Halcyon.preboot().catch((error) => reportDiagnostic("runtime", "failed", error?.message || "Runtime initialization failed"));
    } else if (message.type === "sonsisearch:navigate" && typeof message.url === "string") {
      try {
        const url = new URL(message.url);
        if (url.protocol === "http:" || url.protocol === "https:") launch(url.href);
      } catch { /* Ignore malformed input from a parent window. */ }
    } else if (message.type === "sonsisearch:back") Halcyon.back();
    else if (message.type === "sonsisearch:forward") Halcyon.forward();
    else if (message.type === "sonsisearch:reload") Halcyon.reload();
  });
  notifyParent({ type: "sonsisearch:ready" });
  reportDiagnostic("halcyon-app", "ok", "Embedded app is responding");

  const startupUrl = new URL(location.href).searchParams.get("url");
  if (startupUrl) {
    try {
      const url = new URL(startupUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        setTimeout(() => launch(url.href), 0);
      }
    } catch { /* Invalid startup URL leaves the Halcyon home visible. */ }
  }

  // ---- Bookmarks & History (localStorage; never leaves this browser) --------
  const hostLabel = (url) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
  };
  const avatarLetter = (url) => (hostLabel(url)[0] || "?").toUpperCase();
  const avatarColor = (url) => {
    const h = hostLabel(url);
    let n = 0;
    for (const c of h) n = (n * 31 + c.charCodeAt(0)) >>> 0;
    return `hsl(${n % 360} 58% 46%)`;
  };
  const timeAgo = (ts) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    return Math.floor(h / 24) + "d ago";
  };

  // -- Bookmarks --
  const Bookmarks = {
    all() { try { return JSON.parse(store.get("bookmarks", "[]")); } catch { return []; } },
    save(a) { store.set("bookmarks", JSON.stringify(a)); },
    has(url) { return this.all().some((b) => b.url === url); },
    add(url, title) {
      if (!url || this.has(url)) return;
      const a = this.all();
      a.unshift({ url, title: title || hostLabel(url), at: Date.now() });
      this.save(a);
    },
    remove(url) { this.save(this.all().filter((b) => b.url !== url)); },
  };
  const bmRow = $("#bookmarks");
  const bmLabel = $("#bookmarks-label");
  const starBtn = $("#tb-bookmark");

  function renderBookmarks() {
    const list = Bookmarks.all();
    bmLabel.hidden = bmRow.hidden = list.length === 0;
    bmRow.innerHTML = "";
    for (const b of list) {
      const el = document.createElement("button");
      el.className = "ql";
      el.style.setProperty("--glow", avatarColor(b.url));
      const ico = document.createElement("span");
      ico.className = "ico";
      ico.style.background = avatarColor(b.url);
      ico.textContent = avatarLetter(b.url);
      const name = document.createTextNode(b.title || hostLabel(b.url));
      const x = document.createElement("span");
      x.className = "bm-x";
      x.innerHTML = "&times;";
      x.title = "Remove bookmark";
      x.addEventListener("click", (e) => { e.stopPropagation(); Bookmarks.remove(b.url); renderBookmarks(); });
      el.append(ico, name, x);
      el.addEventListener("click", () => launch(b.url));
      bmRow.appendChild(el);
    }
  }

  const activeTab = () => Halcyon.tabsState().tabs.find((t) => t.active) || null;
  const activeHttpUrl = () => {
    const a = activeTab();
    return a && /^https?:/.test(a.url) ? a.url : "";
  };
  function updateStar() {
    const url = activeHttpUrl();
    starBtn.classList.toggle("active", !!url && Bookmarks.has(url));
  }
  starBtn.addEventListener("click", () => {
    const url = activeHttpUrl();
    if (!url) return;
    const a = activeTab();
    if (Bookmarks.has(url)) Bookmarks.remove(url);
    else Bookmarks.add(url, a && a.title);
    renderBookmarks();
    updateStar();
    toast(Bookmarks.has(url) ? "Bookmarked" : "Bookmark removed");
  });

  // -- History --
  const History = {
    all() { try { return JSON.parse(store.get("history", "[]")); } catch { return []; } },
    save(a) { store.set("history", JSON.stringify(a)); },
    record(url, title) {
      if (!url || !/^https?:/.test(url)) return;
      let a = this.all().filter((h) => h.url !== url);
      a.unshift({ url, title: title || hostLabel(url), at: Date.now() });
      if (a.length > 300) a = a.slice(0, 300);
      this.save(a);
      renderHistory();
    },
    touchTitle(url, title) {
      if (!title) return;
      const a = this.all();
      const it = a.find((h) => h.url === url);
      if (it && it.title !== title) { it.title = title; this.save(a); renderHistory(); }
    },
    clear() { this.save([]); renderHistory(); },
  };
  const histList = $("#history-list");
  const histEmpty = $("#history-empty");

  function renderHistory() {
    const list = History.all();
    histEmpty.hidden = list.length > 0;
    histList.innerHTML = "";
    for (const h of list) {
      const row = document.createElement("div");
      row.className = "hist-item";
      const ico = document.createElement("span");
      ico.className = "hist-ico";
      ico.style.background = avatarColor(h.url);
      ico.textContent = avatarLetter(h.url);
      const main = document.createElement("span");
      main.className = "hist-main";
      const title = document.createElement("span");
      title.className = "hist-title";
      title.textContent = h.title || hostLabel(h.url);
      const url = document.createElement("span");
      url.className = "hist-url";
      url.textContent = h.url;
      main.append(title, url);
      const time = document.createElement("span");
      time.className = "hist-time";
      time.textContent = timeAgo(h.at);
      const x = document.createElement("button");
      x.className = "hist-x";
      x.type = "button";
      x.innerHTML = "&times;";
      x.title = "Remove";
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        History.save(History.all().filter((v) => v.url !== h.url));
        renderHistory();
      });
      row.append(ico, main, time, x);
      row.addEventListener("click", () => launch(h.url));
      histList.appendChild(row);
    }
  }
  $("#history-clear").addEventListener("click", () => {
    if (confirm("Clear all browsing history from this device?")) History.clear();
  });

  // Record visits + keep the star in sync as tabs navigate. Only record once a
  // tab has actually LOADED (loading === false) — otherwise the optimistic
  // pre-navigation URL set on go() (e.g. the typed "wikipedia.org", pre-redirect)
  // gets logged as a separate entry from the resolved page.
  const histSeen = new Map();
  Halcyon.onTabs((state) => {
    for (const t of state.tabs) {
      if (t.url && !t.loading && /^https?:/.test(t.url)) {
        if (histSeen.get(t.id) !== t.url) {
          histSeen.set(t.id, t.url);
          History.record(t.url, t.title);
        } else {
          History.touchTitle(t.url, t.title);
        }
      }
    }
    updateStar();
  });

  renderBookmarks();
  renderHistory();
  updateStar();

  // ---- Settings ----
  const wispIn = $("#set-wisp");
  const transportSelect = $("#set-transport");
  const cloakTitle = $("#set-cloak-title");
  const aboutBlank = $("#set-aboutblank");
  const panicUrl = $("#set-panic-url");

  // Ad blocker toggle + live count (server-side blocking)
  const adblock = $("#set-adblock");
  const adblockCount = $("#adblock-count");
  if (adblock) {
    adblock.checked = store.get("adblock", "1") !== "0";
    const render = (state) => {
      if (!state) return;
      adblock.checked = state.enabled;
      if (adblockCount) {
        adblockCount.textContent = state.blocked
          ? `Blocked ${state.blocked.toLocaleString()} requests · ${state.domains.toLocaleString()} domains on the list.`
          : `${state.domains.toLocaleString()} domains on the list.`;
      }
    };
    Halcyon.adblockState().then(render);
    adblock.addEventListener("change", () => Halcyon.setAdblock(adblock.checked).then(render));
  }

  // AI content-farm blocker toggle (server-side blocking, separate list + pref)
  const aiblock = $("#set-aiblock");
  if (aiblock) {
    aiblock.checked = store.get("aiblock", "1") !== "0";
    aiblock.addEventListener("change", () => Halcyon.setAiblock(aiblock.checked));
  }

  // Discord ad-block toggle (client-side; read live by the Discord injector)
  const discordblock = $("#set-discordblock");
  if (discordblock) {
    discordblock.checked = store.get("discordblock", "1") !== "0";
    discordblock.addEventListener("change", () =>
      store.set("discordblock", discordblock.checked ? "1" : "0")
    );
  }

  // Popup / popunder blocker toggle (client-side; read live in every frame)
  const popupblock = $("#set-popupblock");
  if (popupblock) {
    popupblock.checked = store.get("popupblock", "1") !== "0";
    popupblock.addEventListener("change", () =>
      store.set("popupblock", popupblock.checked ? "1" : "0")
    );
  }

  // Tracking-link cleaner toggle (client-side; read live by cleanUrl)
  const cleanurls = $("#set-cleanurls");
  if (cleanurls) {
    cleanurls.checked = store.get("cleanurls", "1") !== "0";
    cleanurls.addEventListener("change", () =>
      store.set("cleanurls", cleanurls.checked ? "1" : "0")
    );
  }

  const updateTransportDisclosure = () => {
    const selectedMode = store.get("transport", "wisp");
    const bareInUse = transportAtStartup === "bare";
    const bareSelected = selectedMode === "bare";
    $("#transport-warning").hidden = !(bareInUse || bareSelected);
    const activeCopy = bareInUse
      ? "Bare方式ではRenderサービスがHTTPSを終端するため、閲覧内容やサイトのログイン情報を処理できます。履歴とブックマークは引き続きこの端末内に保存されます。"
      : "Wisp方式ではTLS通信をブラウザ側で行うため、RenderサービスはHTTPSサイトの内容を読み取れません。ログイン情報はこのブラウザに保存され、履歴とブックマークも端末内に残ります。";
    $("#session-privacy-copy").textContent = selectedMode === transportAtStartup
      ? activeCopy
      : `${activeCopy} 選択した接続方式は再読み込み後に有効になります。`;
  };
  transportSelect.value = store.get("transport", "wisp") === "bare" ? "bare" : "wisp";
  updateTransportDisclosure();
  transportSelect.addEventListener("change", () => {
    if (transportSelect.value === "bare" && !window.confirm("Bare方式へ切り替えますか？\n\n閲覧ページの内容やサイトのログイン情報をRenderサービスが処理できるようになります。接続方法を変更することについて、ネットワーク管理者の許可も確認してください。")) {
      transportSelect.value = store.get("transport", "wisp");
      return;
    }
    store.set("transport", transportSelect.value);
    updateTransportDisclosure();
    alert("接続方式を保存しました。ページを再読み込みすると適用されます。");
  });

  wispIn.value = store.get("wisp", "");
  cloakTitle.value = store.get("cloakTitle", "");
  aboutBlank.checked = store.get("aboutblank", "0") === "1";
  panicUrl.value = store.get("panicUrl", "https://classroom.google.com");

  wispIn.addEventListener("change", () => {
    wispIn.value.trim() ? store.set("wisp", wispIn.value.trim()) : store.del("wisp");
    alert("Wisp server saved. Reload the page to apply.");
  });
  panicUrl.addEventListener("change", () => store.set("panicUrl", panicUrl.value.trim()));
  aboutBlank.addEventListener("change", () => {
    store.set("aboutblank", aboutBlank.checked ? "1" : "0");
    if (aboutBlank.checked) openInAboutBlank();
  });

  // ---- Tab cloak ----
  function applyCloak() {
    const t = store.get("cloakTitle", "").trim();
    document.title = t || "SonsiSearch";
    const fav = document.querySelector("link[rel=icon]");
    if (t) {
      // Neutral favicon (a document glyph) when cloaked.
      fav.href =
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="%23fff"/><path d="M7 4h7l4 4v12H7z" fill="%23ccc"/></svg>'
        );
    } else {
      fav.href = "/assets/icon.svg";
    }
  }
  cloakTitle.addEventListener("input", () => {
    cloakTitle.value.trim() ? store.set("cloakTitle", cloakTitle.value) : store.del("cloakTitle");
    applyCloak();
  });
  applyCloak();

  // ---- about:blank cloak ----
  function openInAboutBlank() {
    const win = window.open("about:blank", "_blank");
    if (!win) {
      alert("Popup blocked — allow popups to use about:blank cloak.");
      return;
    }
    const iframe = win.document.createElement("iframe");
    iframe.style.cssText = "position:fixed;inset:0;border:none;width:100%;height:100%";
    iframe.src = location.href;
    win.document.body.style.margin = "0";
    win.document.title = store.get("cloakTitle", "").trim() || "Google";
    win.document.body.appendChild(iframe);
    location.replace("https://www.google.com");
  }

  // ---- Panic key (double Esc) ----
  let lastEsc = 0;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const now = Date.now();
      if (now - lastEsc < 500) {
        location.href = store.get("panicUrl", "https://classroom.google.com");
      }
      lastEsc = now;
    }
  });
  $("#panic-btn").addEventListener("click", () => {
    location.href = store.get("panicUrl", "https://classroom.google.com");
  });

  // ---- Wipe session data (sign out of everything, clear all traces) ----
  $("#wipe-btn")?.addEventListener("click", async () => {
    if (!confirm("Sign out of all proxied sites and erase browsing data from this device?"))
      return;
    try {
      // Service workers (Scramjet controller lives here).
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      // Cache storage.
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      // IndexedDB — the Scramjet cookie jar + controller state live here.
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases();
        await Promise.all(dbs.map((d) => d.name && indexedDB.deleteDatabase(d.name)));
      }
    } catch (e) {
      console.warn("wipe:", e);
    }
    location.reload();
  });

  // ---- Theme (day / night) ----
  (function theme() {
    const root = document.documentElement;
    const btn = $("#theme-btn");
    const apply = (t) => {
      if (t === "light") root.setAttribute("data-theme", "light");
      else root.removeAttribute("data-theme");
      store.set("theme", t);
    };
    const initial =
      store.get("theme") ||
      (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    apply(initial);
    btn?.addEventListener("click", () =>
      apply(root.getAttribute("data-theme") === "light" ? "dark" : "light")
    );
  })();

  // ---- Greeting ----
  (function greet() {
    const el = $("#greeting");
    if (!el) return;
    const h = new Date().getHours();
    const part =
      h < 5 ? "Late night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    el.textContent = `${part} — the horizon is clear.`;
  })();

  // ---- Rotating placeholder ----
  (function placeholders() {
    const input = $("#search-input");
    if (!input) return;
    const hints = [
      "Search the web, or paste a link",
      "Try youtube.com",
      "Ask anything…",
      "wikipedia.org/wiki/Kingfisher",
      "Where do you want to go?",
    ];
    let i = 0;
    if (!document.documentElement.classList.contains("sonsisearch-embedded")) {
      setInterval(() => {
        if (input.value || document.activeElement === input) return;
        i = (i + 1) % hints.length;
        input.style.opacity = "0";
        setTimeout(() => { input.placeholder = hints[i]; input.style.opacity = "1"; }, 260);
      }, 4200);
      input.style.transition = "opacity 0.26s ease";
    }
  })();

  // ---- Starfield canvas ----
  (function starfield() {
    if (document.documentElement.classList.contains("sonsisearch-embedded")) return;
    const canvas = document.getElementById("stars");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stars = [];
    let w, h, dpr;

    function resize() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.width = innerWidth * dpr;
      h = canvas.height = innerHeight * dpr;
      canvas.style.width = innerWidth + "px";
      canvas.style.height = innerHeight + "px";
      const count = Math.round((innerWidth * innerHeight) / 9000);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: (Math.random() * 1.2 + 0.3) * dpr,
        a: Math.random() * 0.6 + 0.15,
        tw: Math.random() * 0.02 + 0.004,
        dir: Math.random() < 0.5 ? 1 : -1,
        vy: (Math.random() * 0.12 + 0.02) * dpr,
        warm: Math.random() < 0.45,
      }));
    }

    function frame() {
      ctx.clearRect(0, 0, w, h);
      // Stars belong to the night — skip drawing in daytime mode.
      if (document.documentElement.getAttribute("data-theme") === "light") {
        return requestAnimationFrame(frame);
      }
      for (const s of stars) {
        s.a += s.tw * s.dir;
        if (s.a <= 0.12 || s.a >= 0.8) s.dir *= -1;
        s.y += s.vy;
        if (s.y > h) s.y = 0;
        ctx.globalAlpha = s.a;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = s.warm ? "#ffdca0" : "#eafff6";
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(frame);
    }

    resize();
    addEventListener("resize", resize);
    if (!reduce) frame();
  })();
})();
