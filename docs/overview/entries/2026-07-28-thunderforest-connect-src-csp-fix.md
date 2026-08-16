## 2026-07-28 — Root cause found: `connect-src` CSP, not `img-src`

Fourth and final entry in the Thunderforest map-tile thread (after #800 CSP img-src, #840
whitespace-trim, #844 full-URL-paste extraction, #859 compositor-CSS candidate fix). The owner
finally captured a real online-state DevTools console (previous captures coincided with the
debugging connection itself dropping the device's network — see the #859 entry), and it showed the
actual failure directly:

```
Connecting to 'https://c.tile.thunderforest.com/outdoors/15/30306/18980.png?apikey=...' violates
the following Content Security Policy directive: "connect-src 'self' https://generativelanguage.googleapis.com ...".
The action has been blocked.

Fetch API cannot load https://c.tile.thunderforest.com/.... Refused to connect because it violates
the document's Content Security Policy.
  sw.js:162
```

### Diagnosis
`public/sw-template.js`'s fetch handler re-issues `fetch(e.request)` for every request that doesn't
match one of its earlier special-cased branches (exercise media, `/api/exercise-gif`, `/api/*`,
`/_next/static/*`, navigations) — this catch-all branch is what handles cross-origin tile
`<img>` loads, since they don't match any earlier branch. A `fetch()` call made **from inside a
service worker's own script** is governed by the page's `connect-src` CSP directive, regardless of
what type of resource is being requested — this is true even though the *original* request was an
`<img src>` load, which would itself be governed by `img-src`. `img-src` (fixed in #800) covers the
direct element load; it does not cover the service worker's own internal re-fetch of that same
request. `connect-src` never had the tile domains added, so the SW's fetch was silently blocked,
fell into its `.catch()` handler, found no cached fallback (first load), and returned
`Response.error()` — surfacing to the page as `net::ERR_FAILED` on the image request.

This also explains every previous piece of evidence:
- **curl always worked** — curl doesn't enforce CSP at all.
- **Typing the tile URL in the address bar always worked** — a top-level navigation is not
  governed by `connect-src` (that directive applies to script-initiated fetch/XHR/WebSocket calls,
  not navigations), so it never went through the SW's fetch-CSP path at all.
- **Both the APK and a plain Chrome tab failed identically** — both load the same service worker
  and the same CSP header.
- **Attribution text always rendered correctly** — it's static HTML, not a network request, so it
  was never subject to this at all.
- **All prior server-side verification (CSP img-src, key validity, burst load, referrer, CORS)
  passed** — every one of those checks was against `img-src` or the raw endpoint directly, never
  against what happens when the *service worker itself* re-fetches the same URL.

### Fix
Added `https://*.tile.openstreetmap.org` and `https://*.tile.thunderforest.com` to the `connect-src`
directive in `next.config.ts` (both providers have the identical latent bug — OSM's fallback tiles
would have failed the exact same way for any user without a Thunderforest key).

### Reverted
PR #859's `.leaflet-tile-pane { will-change: transform }` compositor-promotion CSS is removed — it
was a plausible, evidence-consistent hypothesis at the time, but the actual root cause is entirely
explained by the CSP finding above, so the compositor theory doesn't hold and the speculative fix
serves no purpose. `projectOverview.md`'s Known-Issues row for the map is updated to reflect the
confirmed cause instead of the retracted candidate fix.

### Tests
`pnpm lint` clean. No automated test covers CSP header content (`next.config.ts` headers() isn't
exercised by the Jest/Vitest suite); verified by direct inspection of the `connect-src` string.
