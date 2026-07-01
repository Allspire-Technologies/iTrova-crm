// Minimal service worker for installability + a fast/offline-tolerant app shell.
// Scope is intentionally narrow: it only touches SAME-ORIGIN GET requests. Cross-origin
// calls (Supabase REST/RPC/Auth) always go straight to the network — never cached — so data
// is never stale and request mocking/interception is unaffected.

// __BUILD_ID__ is replaced at build time (scripts/stamp-sw.mjs) with the commit SHA, so every
// deploy gets a new cache name — the activate handler below then purges the previous caches.
const VERSION = "__BUILD_ID__";
const CACHE = `adminos-${VERSION}`;

// The build's hashed JS/CSS bundles, injected by scripts/stamp-sw.mjs. Precaching the bundles —
// not just the HTML — is what lets a COLD launch render while offline or on a flaky connection,
// instead of a blank screen while the scripts download. If the placeholder isn't stamped
// (dev/preview) this is just an empty list and we fall back to caching the shell only.
const ASSETS = [/* __PRECACHE__ */];
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg", ...ASSETS];

self.addEventListener("install", (event) => {
  // Best-effort precache: a single missing/oversized asset must not fail the whole install
  // (which would leave the app with no offline shell at all), so cache each entry independently.
  event.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))));
});

self.addEventListener("activate", (event) => {
  // Purge caches from previous builds, then take control of open pages.
  // We deliberately do NOT call skipWaiting(): when a page is already open, a new SW stays in
  // "waiting" and only activates on the next cold launch (once the old page is gone). That avoids
  // taking over a page mid-navigation and deleting the cache the old SW is still reading — the
  // race that could leave a navigation with no response (ERR_FAILED) after a deploy.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle our own origin, GET only. Everything else (Supabase, POST/PATCH) passes through.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // Navigations: serve the cached shell instantly when we have one, while a fresh copy is fetched
  // in the background — but cap the network wait so a slow/hanging connection can't block the
  // launch. The first launch (no cached shell) waits for the network. The handler always resolves
  // to a real Response, so a navigation can't fail with ERR_FAILED.
  if (req.mode === "navigate") {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match("/index.html");
        const fromNetwork = fetch(req).then((res) => {
          if (res && res.ok) cache.put("/index.html", res.clone());
          return res;
        });
        if (!cached) return fromNetwork.catch(async () => (await cache.match("/index.html")) || cache.match("/"));
        return Promise.race([
          fromNetwork.catch(() => cached),
          new Promise((resolve) => setTimeout(() => resolve(cached), 3000)),
        ]);
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
