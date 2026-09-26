"use client";

import { useState, useSyncExternalStore, type ChangeEvent } from "react";
import { clearInstallPrompt, getInstallPrompt } from "@/components/pwa-register";
import { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES, SEARCH_ENGINE_STORAGE_KEY, getSearchEngine, normalizeSearchEngine, type SearchEngine } from "@/lib/search-engine";

export function SettingsPanel() {
  const theme = useSyncExternalStore((notify) => { window.addEventListener("sonsisearch:theme", notify); return () => window.removeEventListener("sonsisearch:theme", notify); }, () => localStorage.getItem("sonsisearch:theme") || "system", () => "system");
  const r18 = useSyncExternalStore((notify) => { window.addEventListener("sonsisearch:r18", notify); return () => window.removeEventListener("sonsisearch:r18", notify); }, () => localStorage.getItem("sonsisearch:r18") === "enabled", () => false);
  const incognito = useSyncExternalStore((notify) => { window.addEventListener("sonsisearch:incognito", notify); return () => window.removeEventListener("sonsisearch:incognito", notify); }, () => localStorage.getItem("sonsisearch:incognito") === "enabled", () => false);
  const installPrompt = useSyncExternalStore((notify) => { window.addEventListener("sonsisearch:installprompt", notify); return () => window.removeEventListener("sonsisearch:installprompt", notify); }, getInstallPrompt, () => null);
  const searchEngine = useSyncExternalStore((notify) => { window.addEventListener("sonsisearch:search-engine", notify); return () => window.removeEventListener("sonsisearch:search-engine", notify); }, getSearchEngine, () => DEFAULT_SEARCH_ENGINE);
  const [ageCheck, setAgeCheck] = useState(false);
  function chooseTheme(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    localStorage.setItem("sonsisearch:theme", value);
    const applied = resolveTheme(value);
    document.documentElement.dataset.theme = applied;
    const color = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]'); if (color) color.content = applied === "light" ? "#f3f6fc" : applied === "divine" ? "#f8f4ed" : applied === "cyber" ? "#080a16" : "#0b1020";
    window.dispatchEvent(new Event("sonsisearch:theme"));
  }
  function toggleR18() {
    if (r18) {
      localStorage.removeItem("sonsisearch:r18");
      document.documentElement.dataset.r18 = "false";
      window.dispatchEvent(new Event("sonsisearch:r18"));
    } else setAgeCheck(true);
  }
  function confirmR18() {
    localStorage.setItem("sonsisearch:r18", "enabled");
    document.documentElement.dataset.r18 = "true";
    setAgeCheck(false);
    window.dispatchEvent(new Event("sonsisearch:r18"));
  }
  function toggleIncognito() {
    const next = !incognito;
    if (next) localStorage.setItem("sonsisearch:incognito", "enabled");
    else localStorage.removeItem("sonsisearch:incognito");
    window.dispatchEvent(new Event("sonsisearch:incognito"));
  }
  function chooseSearchEngine(event: ChangeEvent<HTMLSelectElement>) {
    const value = normalizeSearchEngine(event.target.value);
    localStorage.setItem(SEARCH_ENGINE_STORAGE_KEY, value);
    window.dispatchEvent(new Event("sonsisearch:search-engine"));
  }
  async function install() {
    const prompt = installPrompt as (Event & { prompt?: () => Promise<void> }) | null;
    await prompt?.prompt?.(); clearInstallPrompt();
  }
  return <main className="data-page page-enter"><span className="eyebrow">PERSONALIZE</span><h1>Settings</h1><section className="glass-panel settings-card">
    <div className="settings-toggle"><span><strong>Search engine</strong><small>Searches open in SonsiSearch Browser through the selected proxy.</small></span><select className="theme-chip settings-select" aria-label="Search engine" value={searchEngine as SearchEngine} onChange={chooseSearchEngine}>{Object.entries(SEARCH_ENGINES).map(([id, engine]) => <option key={id} value={id}>{engine.label}</option>)}</select></div>
    <div className="settings-toggle"><span><strong>Appearance</strong><small>Use the device setting by default, or choose a theme.</small></span><select className="theme-chip settings-select" aria-label="Appearance" value={theme} onChange={chooseTheme}><option value="system">Device setting</option><option value="light">Light</option><option value="dark">Dark</option><option value="cyber">Cyber</option><option value="divine">Divine</option></select></div>
    <button className="settings-toggle" onClick={toggleIncognito} aria-pressed={incognito}><span><strong>Incognito mode</strong><small>{incognito ? "New Browser pages will not save SonsiSearch history or bookmarks." : "Do not save pages to SonsiSearch history or bookmarks."}</small></span><span className={`settings-switch${incognito ? " is-on" : ""}`}>{incognito ? "On" : "Off"}</span></button>
    <button className="settings-toggle" onClick={toggleR18} aria-pressed={r18}><span><strong>R18 mode</strong><small>{r18 ? "Adult links are enabled and the red glow theme is active." : "18+ links stay locked until you confirm your age."}</small></span><span className={`settings-switch${r18 ? " is-on r18-switch" : ""}`}>{r18 ? "On" : "Off"}</span></button>
    <div className="settings-toggle"><span><strong>Install SonsiSearch V2</strong><small>Add the app to your home screen for a standalone experience</small></span>{installPrompt ? <button className="action-button" onClick={install}>Install</button> : <span className="theme-chip">Use browser menu</span>}</div>
  </section>
  {ageCheck && <div className="age-prompt" role="dialog" aria-modal="true" aria-label="Age confirmation"><div className="age-prompt-card"><span className="adult-label">18+ AGE CHECK</span><h3>18歳以上ですか？</h3><p>R18リンクと赤いテーマを有効にします。</p><div><button onClick={() => setAgeCheck(false)}>キャンセル</button><button className="adult-confirm" onClick={confirmR18}>18歳以上です</button></div></div></div>}
  </main>;
}

function resolveTheme(preference: string) {
  if (preference === "light" || preference === "dark" || preference === "cyber" || preference === "divine") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
