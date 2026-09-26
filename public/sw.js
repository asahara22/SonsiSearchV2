const VERSION = "sonsisearch-shell-v3";
const SHELL = ["/", "/offline.html", "/sonsisearch-logo.png", "/icons/sonsisearch-icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      return cached || caches.match("/offline.html");
    }));
    return;
  }
  if (SHELL.includes(url.pathname)) event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
