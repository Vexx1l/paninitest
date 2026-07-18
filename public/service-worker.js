// Minimal service worker: just enough to make the app installable as a PWA
// and let it open/work without a live connection. Not a full offline-first
// strategy — Firebase sync calls and font requests always go to the
// network as normal; only the app's own static files are cached.

const CACHE_VERSION = "v2";
const CACHE_NAME = `album-mundial-2026-${CACHE_VERSION}`;

const APP_SHELL = [
  "./",
  "./style.css",
  "./app.js",
  "./sections.json",
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

// Cache-first for the app's own same-origin files (so it opens instantly
// and still works with no connection); everything else (Firebase, fonts,
// etc.) just passes straight through to the network untouched.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
