// Service worker: makes HomeApprox installable and gives an offline fallback.
//
//   page (HTML)       → network first (revalidated), cache only when offline
//   own static files  → cache first (icons, manifest)
//   anything else     → not touched (transport API, fonts): always live
//
// Bump VERSION when the list of cached files changes.
const VERSION = "v1";
const CACHE = `homeapprox-${VERSION}`;
const SHELL = ["./", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];
const OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
  '<title>HomeApprox</title><body style="font:17px system-ui;padding:2rem;text-align:center">' +
  "<h1>Keine Verbindung</h1><p>HomeApprox braucht Internet für Fahrplandaten.</p></body>";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("homeapprox-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API, fonts: never cached

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req, { cache: "no-cache" })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("./", copy));
          }
          return res;
        })
        .catch(async () =>
          (await caches.match("./")) ||
          new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })),
    );
    return;
  }

  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
