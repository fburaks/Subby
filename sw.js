// Çevrimdışı çalışma için basit önbellek. Dosyaları değiştirince VERSION'ı artır.
const VERSION = "subby-v2";
const ASSETS = [
  "./", "index.html", "manifest.webmanifest", "css/style.css",
  "js/app.js", "js/catalog.js", "js/dates.js", "js/detect.js", "js/ics.js", "widget/subby-widget.js",
  "icons/icon.svg", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Önce ağ, olmazsa önbellek: güncellemeler hemen gelir, çevrimdışıyken de açılır.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("index.html"))),
  );
});
