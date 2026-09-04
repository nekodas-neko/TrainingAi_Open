const CACHE = "__CACHE_NAME__";
const PRECACHE_URLS = __PRECACHE_URLS__;
const META = "ta-meta";           // persistent — holds the previous build's cache name
const OFFLINE_URL = "/offline";

self.addEventListener("install", (e) => {
  // Precache the immutable static asset set + the offline fallback document.
  // allSettled (not cache.addAll): one transient 404/opaque response must not
  // fail the whole install. Authenticated documents are still NOT precached —
  // only content-hashed statics and the unauthenticated /offline page.
  e.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      // Retain the current build's cache AND the immediately-previous one, so a
      // deploy no longer empties offline coverage. `ta-meta.prev` points at the
      // build that was current as of the last activation; keep it + the new
      // current, delete everything older, then record the new current as prev.
      const meta = await caches.open(META);
      const prevRes = await meta.match("prev");
      const prev = prevRes ? await prevRes.text() : null;
      const keep = new Set([CACHE, META, ...(prev ? [prev] : [])]);
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
      await meta.put("prev", new Response(CACHE));
      await self.clients.claim();
      // No client.navigate() force-reload: the retained previous generation keeps
      // already-open pages' chunks resolvable, so the new build is adopted on the
      // next natural navigation instead of yanking the user (mid-workout included).
    })()
  );
});

// Q-285: the `push` and `notificationclick` handlers lived here. The web-push stack they served
// had no senders and no subscribers and was deleted at the owner's decision; `notificationclick`
// was only reachable from a notification this handler had shown. The app's real notifications are
// native Android (OuraRingService, ScaleBleService, PolarStrapService, DeviceBatteryNotifier) and
// Capacitor local notifications — neither goes through the service worker. The rest of this file
// stays: it is the APK's offline cold-start, which CLAUDE.md is explicit about not removing.

// Match a request against ONLY the two cache generations whose chunks still
// exist — the current build and the one `activate` retains as `prev`. A plain
// caches.match() searches every cache still on disk, which for a cached document
// means potentially serving one whose _next/static chunks were already deleted.
// That is the single failure mode that makes serving documents from cache unsafe,
// so it is excluded structurally rather than left to chance.
async function matchLiveCaches(request) {
  const meta = await caches.open(META);
  const prevRes = await meta.match("prev");
  const prevName = prevRes ? await prevRes.text() : null;
  for (const name of [CACHE, ...(prevName && prevName !== CACHE ? [prevName] : [])]) {
    if (!(await caches.has(name))) continue;
    const cache = await caches.open(name);
    const hit = await cache.match(request);
    if (hit) return hit;
  }
  return null;
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Cache-first for exercise media binaries (GIFs and frames stored in S3).
  if (url.pathname.includes("/exercise-media/")) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Stale-while-revalidate for exercise GIF URL lookups.
  if (url.pathname === "/api/exercise-gif") {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(e.request);
        const fetchPromise = fetch(e.request)
          .then((res) => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => null);
        return cached ?? (await fetchPromise);
      })
    );
    return;
  }

  // Never cache other API calls — always go to network. `cache: "no-store"` is what makes that
  // sentence true: a bare fetch() here still consults the browser's HTTP cache, and aggregate GET
  // routes ship `Cache-Control: private, max-age=60`, so this branch was answering from that cache
  // without a network trip. Measured: after DELETE /api/supplements/<id> the list request kept
  // returning the deleted row, because an unsafe method only invalidates its OWN url.
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(e.request, { cache: "no-store" }));
    return;
  }

  // BF-92. Sentry's tunnel (`tunnelRoute` in next.config.ts). Handed to the browser untouched —
  // NOT merely uncached — because the catch-all branch at the bottom would `cache.put()` it, and
  // the Cache API rejects a POST Request. A successful envelope returns 200, so `res.ok` holds and
  // every single error report would raise an unhandled rejection inside the service worker: noise
  // generated by the error reporter, in the one place nobody is watching.
  //
  // This is the third gate on the same path. `connect-src` blocked it for 13 days, the auth
  // matcher would have 307'd it, and this would have made it loud in the wrong direction — none of
  // which is visible from the browser, which is why the entry's Gate is the device.
  if (url.pathname === "/monitoring") {
    return;
  }

  // Cache-first for app icons. /favicon.ico is 26 kB and matched no cache rule,
  // so it fell through to the network-first branch and was re-downloaded on every
  // screen — measured on-device at 338 ms–1.43 s per screen, twice per screen, the
  // slowest recurring request in the app. The content-hashed /icon route beside it
  // was already fast because it matched _next/static below.
  if (url.pathname === "/favicon.ico" || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/icon")) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Cache-first for static assets (_next/static). Only store ok responses.
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Top-level navigations: network-first.
  //
  // ⚠️ REVERTED from stale-while-revalidate 2026-07-29 after it broke cold start
  // on the owner's device — nearly two minutes to usable, worse than the problem
  // it fixed. Do not reintroduce SWR here without solving the cause below.
  //
  // The failure: the WebView points at a `main` that redeploys many times a day.
  // Serving a cached document means serving one stamped with an OLD Next build id
  // while the server is on a new one. The first RSC fetch then mismatches, Next
  // hard-reloads to recover, the SW serves the same stale document again, and it
  // loops — the app paints its shell but never gets data.
  //
  // Retaining two cache generations does NOT prevent this. `activate` only runs
  // when a new SW installs, so `prev` is whatever was current at the *last app
  // open*, not the previous deploy. Open the app after several deploys and the
  // cached document is many builds stale while still counting as "live".
  //
  // A future attempt must make the cached document's build id verifiable against
  // the server's before serving it, not merely bound how old it is allowed to be.
  const AUTH_PAGES = ["/sign-in", "/pending", "/register"];
  if (e.request.mode === "navigate" && !AUTH_PAGES.includes(url.pathname)) {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(e.request);
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        } catch {
          // Offline only: a stale document beats no app at all.
          const cached = await matchLiveCaches(e.request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          return offline ?? Response.error();
        }
      })()
    );
    return;
  }

  // RSC payloads: network-first, for the same reason as the document above. A
  // cached RSC payload carries a build id too, so serving it stale feeds exactly
  // the same mismatch-and-reload loop. Reverted 2026-07-29 alongside the document.
  //
  // Everything else (auth pages, Server Action POSTs): network-first with the
  // existing offline fallback to the exact cached response. res.ok guard stops a
  // 500/redirect poisoning the per-URL cache entry.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(async () => {
        const exact = await caches.match(e.request);
        if (exact) return exact;
        return Response.error();
      })
  );
});
