/*
 * Keep the app usable without a connection, but never let Cache Storage hide
 * a responsive newer deployment. Every same-origin GET goes to the network
 * first, bypassing the browser HTTP cache. A cached response is used only
 * when the request fails, times out, or the server returns a 5xx response.
 */
const CACHE_NAME = "sudoku-app-shell-v3";
const NETWORK_TIMEOUT_MS = 3000;
const APP_SHELL_URL = new URL("./", self.registration.scope).href;
const INDEX_URL = new URL("index.html", self.registration.scope).href;
const APP_SHELL = [
  APP_SHELL_URL,
  INDEX_URL,
  new URL("styles.css", self.registration.scope).href,
  new URL("js/board.js", self.registration.scope).href,
  new URL("js/exact.js", self.registration.scope).href,
  new URL("js/logical.js", self.registration.scope).href,
  new URL("js/difficulty.js", self.registration.scope).href,
  new URL("js/generator.js", self.registration.scope).href,
  new URL("js/game.js", self.registration.scope).href,
  new URL("js/persistence.js", self.registration.scope).href,
  new URL("js/view.js", self.registration.scope).href,
  new URL("js/app.js", self.registration.scope).href
];

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);

  await Promise.all(APP_SHELL.map(async (url) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not cache ${url}: ${response.status}`);
    await cache.put(url, response);
  }));
}

async function cacheResponse(request, response) {
  if (!response.ok) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}

async function fetchWithTimeout(request) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

  try {
    // Avoid serving an outdated response from the browser's HTTP cache.
    return await fetch(request, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function cachedFallback(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request, { ignoreSearch: true });
  if (cachedResponse) return cachedResponse;

  if (request.mode === "navigate") {
    return (await cache.match(APP_SHELL_URL)) ||
      (await cache.match(INDEX_URL)) ||
      new Response("The app is unavailable offline until it has been opened once online.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
  }

  return new Response("Offline", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await cacheAppShell();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((names) => Promise.all(
      names
        .filter((name) => name.startsWith("sudoku-app-shell-") && name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    )),
    self.clients.claim()
  ]));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Let cross-origin requests and all mutations follow the browser's normal
  // behavior; this worker only owns the Sudoku application's read requests.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const response = await fetchWithTimeout(request);

      if (response.ok) {
        // Cache successful network content before returning it, so the latest
        // app shell is ready if the next request is offline.
        await cacheResponse(request, response).catch(() => {});
        return response;
      }

      // Do not hide genuine client errors, such as a missing resource, with
      // an older cached copy. Server failures may use the offline fallback.
      if (response.status < 500) return response;
    } catch {
      // Offline and timed-out requests use the cache below.
    }

    return cachedFallback(request);
  })());
});
