// Minimal service worker for installability + a fast/offline-tolerant app shell.
// Scope is intentionally narrow: it only touches SAME-ORIGIN GET requests. Cross-origin
// calls (Supabase REST/RPC/Auth) always go straight to the network — never cached — so data
// is never stale and request mocking/interception is unaffected.

const VERSION = "v1";
const CACHE = `adminos-${VERSION}`;
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle our own origin, GET only. Everything else (Supabase, POST/PATCH) passes through.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // Navigations: network-first, fall back to the cached shell when offline (SPA).
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put("/index.html", res.clone()));
          return res;
        })
        .catch(() => caches.match("/index.html").then((r) => r || caches.match("/"))),
    );
    return;
  }

  // Static assets (hashed JS/CSS/img): cache-first, then populate the cache.
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
