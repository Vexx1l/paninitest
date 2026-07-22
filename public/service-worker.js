// Minimal service worker: just enough to make the app installable as a PWA
// and let it open/work without a live connection. Not a full offline-first
// strategy — Firebase sync calls and font requests always go to the
// network as normal; only the app's own static files are cached.
//
// Strategy: NETWORK-FIRST with cache fallback. We always try the network
// first so a new deploy shows up immediately the next time you open the
// app with a connection; the cache is only used as a fallback when
// there's no connection at all. (A pure cache-first strategy — the
// previous version of this file — is why updates can silently stop
// showing up: bump CACHE_VERSION below any time you want to force every
// existing cache to be thrown out on the next visit.)

const CACHE_VERSION = "v3";
const CACHE_NAME = `album-mundial-2026-${CACHE_VERSION}`;

const APP_SHELL = [
  "./",
  "./style.css",
  "./app.js",
  "./sections.json",
  "./extras-data.json",
  "./firebase-config.js",
  "./manifest.webmanifest",
  "./vendor/jsQR.js",
  "./vendor/qrcode.js",
  "./vendor/pako.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for the app's own same-origin files: try the network so
// deploys show up right away, and only fall back to the cache if the
// network request fails (offline). Everything else (Firebase, fonts,
// etc.) passes straight through untouched.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
