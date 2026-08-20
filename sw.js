// myshelf service worker — caches the app shell for offline use.
const CACHE = "myshelf-v5";
const ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-180.png",
  "/bookend-l.png",
  "/bookend-r.png",
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js",
  "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js",
  "https://unpkg.com/@zxing/library@0.20.0/umd/index.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  // Never cache the ISBN API — it needs live network (and won't work offline).
  if (request.url.includes("/api/")) {
    e.respondWith(fetch(request).catch(() => new Response(
      JSON.stringify({ error: "Offline — barcode lookup needs internet" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    )));
    return;
  }
  // Cache-first for everything else (app shell, libraries, icons).
  e.respondWith(
    caches.match(request).then((cached) =>
      cached || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => { try { c.put(request, copy); } catch {} });
        return res;
      }).catch(() => cached)
    )
  );
});
