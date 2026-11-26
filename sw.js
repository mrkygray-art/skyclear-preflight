// SkyClear service worker: makes the app installable and lets the app shell open on a weak connection.
// Rules:
// - Never touch /api/ (live weather) or other websites (FAA, USGS, NWS, map tiles from Esri).
//   Weather must always be live or clearly labeled SAMPLE by the app, never an old saved copy.
// - Network first, so every deploy shows up right away. The saved copy is only used when offline.
const CACHE = "skyclear-shell-v2";
const SHELL = ["/", "/leaflet.js", "/leaflet.css", "/favicon.ico", "/icon-192.png", "/manifest.webmanifest", "/data/uasfm_ca_lv.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // other websites: browser handles normally
  if (url.pathname.startsWith("/api/")) return;    // live weather: never cached here
  const shellKey = req.mode === "navigate" ? "/" : url.pathname;
  if (req.mode !== "navigate" && !SHELL.includes(url.pathname)) return; // chart tiles etc: normal browser caching
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(shellKey, copy)); }
        return res;
      })
      .catch(() => caches.match(shellKey))
  );
});
