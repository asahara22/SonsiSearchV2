"use client";

import { useEffect } from "react";

let deferredInstall: Event | null = null;
export function getInstallPrompt() { return deferredInstall; }
export function clearInstallPrompt() { deferredInstall = null; if (typeof window !== "undefined") window.dispatchEvent(new Event("sonsisearch:installprompt")); }

export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const captureInstall = (event: Event) => {
      event.preventDefault(); deferredInstall = event;
      window.dispatchEvent(new Event("sonsisearch:installprompt"));
    };
    window.addEventListener("beforeinstallprompt", captureInstall);
    return () => window.removeEventListener("beforeinstallprompt", captureInstall);
  }, []);
  return null;
}
