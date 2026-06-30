// Minimal service worker for installability + a fast/offline-tolerant app shell.
// Scope is intentionally narrow: it only touches SAME-ORIGIN GET requests. Cross-origin
// calls (Supabase REST/RPC/Auth) always go straight to the network — never cached — so data
// is never stale and request mocking/interception is unaffected.

// __BUILD_ID__ is replaced at build time (scripts/stamp-sw.mjs) with the commit SHA, so every
// deploy gets a new cache name — the activate handler below then purges the previous caches.
// Falls back to "dev" for un-stamped local builds.
const VERSION = "__BUILD_ID__";
const CACHE = `adminos-${VERSION}`;
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  // Cache shell entries independently (allSettled, not addAll) so a single transient failure on a
  // non-critical asset (e.g. the icon) can't abort the whole install and leave the shell uncached
  // — the cached shell is what lets navigations paint instantly on the next launch.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
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

  // Navigations: serve the cached app shell first so the PWA paints instantly on launch — even
  // before the phone has connectivity at cold start. (Network-first here used to hang on a
  // not-yet-ready / slow mobile connection, leaving a blank screen on open.) Freshness is handled
  // out-of-band: every deploy stamps a new cache VERSION, and `activate` purges the old cache and
  // precaches the current shell, so the cached "/index.html" always belongs to this deploy.
  if (req.mode === "navigate") {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match("/index.html");
        if (cached) return cached;
        // First load of this version (shell not cached yet): go to the network, cache it, and
        // fall back to whatever shell we have if the network is unavailable.
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put("/index.html", res.clone());
          return res;
        } catch {
          return (await cache.match("/index.html")) || cache.match("/");
        }
      }),
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
