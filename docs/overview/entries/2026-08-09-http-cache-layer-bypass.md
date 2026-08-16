# 2026-08-09 — a cache `invalidateCache()` could not reach, and a service worker comment that wasn't true

**Branch:** `chore/aggregate-route-swr-headers` · **Domain:** `platform`, `app-shell` · **v1.276.3**

## What I set out to do, and why I stopped

Q-166 asked for `Cache-Control: private, max-age=60, stale-while-revalidate=120` on 12 GET routes
that ship without it, per the CLAUDE.md rule that new aggregate routes get SWR headers at creation.

Before adding it I checked what the header actually does here, because several of those routes are
written by the client and then re-read — `phase-sets`, `workout-templates`, `day-checkin`,
`friends`, `coach/threads`, `scale-ble/today`. A 60-second browser cache in front of a
read-after-write is the exact stale-repaint shape CLAUDE.md calls the most repeated bug class in
this project.

It measured worse than expected, and the problem was already shipped.

## What was measured, in a real browser

| case | normal fetch | `cache: 'no-store'` |
|---|---|---|
| `POST /api/phase-sets` → `GET /api/phase-sets` | 5 (correct) | 5 |
| `DELETE /api/phase-sets/<id>` → `GET /api/phase-sets` | **5 (stale — deleted row still listed)** | 4 |
| `DELETE /api/supplements/<id>` → `GET /api/supplements` | **1 (stale)** | 0 |

The split is the mechanism: an unsafe method invalidates the HTTP cache entry for **its own URL**,
so a write that posts to the same URL it reads is self-healing. A write to a *different* URL —
`DELETE /api/supplements/<id>` against `GET /api/supplements` — is not, and the deleted row keeps
coming back for up to a minute.

**`/api/supplements` already ships the header on `main`.** So this was not a hazard the sweep would
have introduced; it was a live bug the sweep would have spread to 12 more routes.

Why it has stayed hidden: it only bites where the write URL differs from the read URL, which is a
minority of the app's write paths, and the window is 60 seconds. On the screens where it does bite
it looks like a sync delay rather than a cache fault.

## The layer nobody was invalidating

The app's cache discipline is built on `cachedFetch` + named invalidation groups. The browser's
HTTP cache sits **underneath** that, holds the same payloads, and `invalidateCache()` cannot touch
it. It is a second cache with no invalidation path at all.

The service worker was supposed to be the thing preventing this. Its `/api/` branch reads:

```js
// Never cache other API calls — always go to network.
if (url.pathname.startsWith("/api/")) {
  e.respondWith(fetch(e.request));
```

That comment describes the intent correctly and the code does not implement it: a bare `fetch()`
inside a service worker still consults the HTTP cache. With `max-age=60` on the response, that
branch was answering from cache without a network trip — which is how a request that the app
believed always went to the network returned a deleted row.

## The fix

Two lines, both making existing intent true:

- `lib/sqlite/cache.ts` — `cachedFetch`'s network call sends `cache: 'no-store'`, so the
  revalidation half of stale-while-revalidate cannot be answered by a cache the app can't clear.
- `public/sw-template.js` — the `/api/` passthrough sends `cache: "no-store"`, which is what makes
  its own comment accurate. This one also covers bare `fetch` reads, which is why the measured
  supplements case (a raw page fetch) went green.

No offline regression: `no-store` fails the same way a network fetch already failed offline, and
`cachedFetch` falls back to its own localStorage/SQLite seed exactly as before.

## Q-166 is on hold, deliberately

With the service worker bypassing the HTTP cache for every `/api/` request, `Cache-Control` on
these routes now governs almost nothing on the canonical runtime. Adding it to 12 more routes would
be consistency with a convention whose benefit is unmeasured — so the entry was rewritten with the
measurement rather than cleared, and it names the three options. The one the evidence points at
(API responses should be `private, no-store`, because this app manages its own cache) contradicts a
standing CLAUDE.md rule, which makes it an architecture call, not an implementer's.

## Verified

- `tsc --noEmit` clean · **429 files / 3422 tests** green · all 14 custom-rule scripts pass · eslint
  clean on the changed files.
- Browser at 412×915: the delete-then-list case above went from **1 (stale)** to **0** after the
  fix, measured on `/api/supplements`, a route already carrying the header on `main`.
- Smoke across `/`, `/health`, `/nutrition`, `/workout-select`, `/more`, `/coach` with the service
  worker in control: every screen renders, no `/api/` 4xx or 5xx, and `POST /api/mood` — a write
  with a body, the case `cache: "no-store"` could plausibly have broken in the service worker —
  returns 200.
- The `/coach` screen printed "You're offline" during one smoke pass. Checked rather than assumed:
  it gates on `navigator.onLine`, which involves no fetch, and reads `true` on a bare load. Harness
  state, not this change.

## Not exercised

The APK — and this one touches the service worker, which is the APK's network path and its
offline-cold-start mechanism. The change is verified in Chromium (same engine family as the S25
WebView) but **not on device**, and a service-worker fault there is not subtle. Also unexercised:
the real offline path (airplane mode with a populated seed), and the native SQLite cache layer,
since `isSQLiteAvailable()` is false in the sandbox.
