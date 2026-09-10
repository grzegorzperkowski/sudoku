/*
 * The application has no external runtime dependencies. Keeping the complete
 * shell in one cache means a subsequent visit can be served with no network.
 * Increment CACHE_NAME whenever a release changes one of these files.
 */
const CACHE_NAME = "sudoku-app-shell-v1";
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

  if (request.mode === "navigate") {
    event.respondWith(networkWithOfflinePage(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkWithOfflinePage(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request, { ignoreSearch: true })) ||
      (await caches.match("./index.html"));
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}
