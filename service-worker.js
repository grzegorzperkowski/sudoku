/*
 * The application has no external runtime dependencies. Keeping the complete
 * shell in one cache means a subsequent visit can be served with no network.
 * Increment CACHE_NAME whenever a release changes one of these files.
 */
const CACHE_NAME = "sudoku-app-shell-v2";
const APP_SHELL = [
  "./index.html",
  "./styles.css",
  "./js/board.js",
  "./js/exact.js",
  "./js/logical.js",
  "./js/difficulty.js",
  "./js/generator.js",
  "./js/game.js",
  "./js/persistence.js",
  "./js/view.js",
  "./js/app.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((names) => Promise.all(
        names
          .filter((name) => name.startsWith("sudoku-app-shell-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )),
      self.clients.claim()
    ])
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(serveCachedAppShell(request));
});

async function serveCachedAppShell(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  if (request.mode === "navigate") return (await caches.match("./index.html")) || Response.error();
  return Response.error();
}
