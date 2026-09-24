"use client";

import { useEffect, useSyncExternalStore } from "react";
import { clearInstallPrompt, getInstallPrompt } from "@/components/pwa-register";

export function SettingsPanel() {
  const theme = useSyncExternalStore((notify) => { window.addEventListener("sonsisearch:theme", notify); return () => window.removeEventListener("sonsisearch:theme", notify); }, () => localStorage.getItem("sonsisearch:theme") || "dark", () => "dark");
  const installPrompt = useSyncExternalStore((notify) => { window.addEventListener("sonsisearch:installprompt", notify); return () => window.removeEventListener("sonsisearch:installprompt", notify); }, getInstallPrompt, () => null);
  useEffect(() => {
    document.documentElement.dataset.theme = localStorage.getItem("sonsisearch:theme") || "dark";
  }, []);
  function toggleTheme() {
    const value = theme === "dark" ? "light" : "dark";
    localStorage.setItem("sonsisearch:theme", value); document.documentElement.dataset.theme = value;
    const color = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]'); if (color) color.content = value === "light" ? "#edf2fa" : "#0b1020";
    window.dispatchEvent(new Event("sonsisearch:theme"));
  }
  async function install() {
    const prompt = installPrompt as (Event & { prompt?: () => Promise<void> }) | null;
    await prompt?.prompt?.(); clearInstallPrompt();
  }
  return <main className="data-page page-enter"><span className="eyebrow">PERSONALIZE</span><h1>Settings</h1><section className="glass-panel settings-card"><button className="settings-toggle" onClick={toggleTheme}><span><strong>Appearance</strong><small>Switch between dark and light theme</small></span><span className="theme-chip">{theme === "dark" ? "Dark" : "Light"}　◐</span></button><div className="settings-toggle"><span><strong>Install SonsiSearch</strong><small>Add the app to your home screen for a standalone experience</small></span>{installPrompt ? <button className="action-button" onClick={install}>Install</button> : <span className="theme-chip">Use browser menu</span>}</div></section><p className="hint">Search preferences and privacy controls will be added here.</p></main>;
}
