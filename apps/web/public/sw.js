/*
 * Qrono's offline helper for the guest page (/g/<link>), opened from an email on a phone.
 * Once a guest has opened their page, the page itself, its scripts and styles, and their
 * program are saved in the browser, so reopening the link with no connection still shows the
 * countdown and the program. Everything else passes straight through.
 *
 * - The page: network first, the saved copy when offline.
 * - Scripts and styles (/assets/, named by content): saved once, then served from the browser.
 * - The guest's program (/api/guest/<link>): network first; offline, the saved copy, marked
 *   with when it was saved (offlineSavedAt) so the page can say "Last updated 11:42".
 */
const CACHE = "qrono-guest-v1";
const SHELL = "/g/__shell";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// The page asks to save what it has already loaded (it loaded before this helper was running).
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "save" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        data.urls.map(async (url) => {
          const u = new URL(url, self.location.origin);
          if (u.origin !== self.location.origin) return;
          try {
            if (u.pathname.startsWith("/g/")) await cache.put(SHELL, await fetch(u, { credentials: "same-origin" }));
            else if (u.pathname.startsWith("/api/guest/")) await saveProgram(cache, u.href, await fetch(u));
            else if (u.pathname.startsWith("/assets/") && !(await cache.match(u.href))) await cache.put(u.href, await fetch(u));
          } catch {
            /* offline already: nothing to save */
          }
        }),
      ),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate" && url.pathname.startsWith("/g/")) {
    event.respondWith(
      fetch(req)
        .then(async (res) => {
          if (res.ok) (await caches.open(CACHE)).put(SHELL, res.clone());
          return res;
        })
        .catch(async () => (await caches.match(SHELL, { ignoreVary: true })) || Response.error()),
    );
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      // By address alone: a different Vary header (e.g. Origin) mustn't make a saved file miss.
      caches.match(url.href, { ignoreVary: true, ignoreSearch: true }).then(
        (hit) =>
          hit ||
          fetch(req).then(async (res) => {
            if (res.ok) (await caches.open(CACHE)).put(url.href, res.clone());
            return res;
          }),
      ),
    );
  } else if (url.pathname.startsWith("/api/guest/") && !url.pathname.endsWith("/response")) {
    event.respondWith(
      fetch(req)
        .then(async (res) => {
          await saveProgram(await caches.open(CACHE), req.url, res.clone());
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(req.url, { ignoreVary: true });
          if (!hit) return Response.error();
          const saved = await hit.json();
          return new Response(JSON.stringify(saved), { headers: { "Content-Type": "application/json" } });
        }),
    );
  }
});

/** Saves a guest's program with the time it was saved, for "Last updated" when it's used offline. */
async function saveProgram(cache, url, res) {
  if (!res.ok) return;
  const body = await res.json();
  await cache.put(url, new Response(JSON.stringify({ ...body, offlineSavedAt: Date.now() }), { headers: { "Content-Type": "application/json" } }));
}
