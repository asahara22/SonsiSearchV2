"use client";

import { useEffect, useState } from "react";

export function SplashScreen() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("sonsisearch:splash-seen")) return;
      sessionStorage.setItem("sonsisearch:splash-seen", "1");
    } catch { /* The splash is optional when storage is disabled. */ }
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 1900);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;
  return <div className="splash-screen" role="status" aria-label="SonsiSearch V2 is starting" onClick={() => setVisible(false)}>
    <div className="splash-stars" aria-hidden="true"><i>✦</i><i>✧</i><i>✦</i><i>·</i><i>✧</i><i>·</i></div>
    <div className="splash-halo" aria-hidden="true"><span className="splash-mark">S</span></div>
    <div className="splash-title">Sonsi<span>Search</span><b>V2</b></div>
    <p>検索して、見つけて、そのまま読む。</p>
    <div className="splash-progress" aria-hidden="true"><span /></div>
    <small>CLICK TO CONTINUE</small>
  </div>;
}
