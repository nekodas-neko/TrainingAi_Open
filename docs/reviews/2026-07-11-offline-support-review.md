# Offline Support Review — why the app is unusable with no reception

**Date:** 2026-07-11 · **Trigger:** owner report — "Today I had no reception and the app's pages
would not load and it was not useable." · **Scope:** the full offline story: app shell (service
worker / WebView / navigation), data reads, and how the existing local-store/outbox layer fits in.
**Method:** static review of `main` (`55e7186`) plus an **empirical reproduction** against a
production build (`pnpm build` + `pnpm start`, Chromium via Playwright, offline simulated by
killing the server — Playwright's `setOffline` does not apply to service-worker fetches, so
server-kill is the honest simulation).

## Verdict in one paragraph

The **data layer is not the problem** — on the APK, every primary screen reads local-first or
cache-seeded and renders meaningful data offline. What fails is the **app shell**: the APK is a
thin WebView pointed at the Railway URL (`capacitor.config.ts:8-11`) with **no bundled assets**,
so offline the shell exists only as far as the service worker has happened to cache it — and the
SW (`public/sw-template.js`) precaches **nothing**, caches pages only reactively
(network-first), **wipes its entire cache on every deploy**, and has **no offline fallback**.
In an SPA, "pages visited as full documents" is essentially just the entry URL — so offline,
any cold start at a non-entry route is a raw Chromium error page, and warm tab navigation dies
on the first lazy-loaded JS chunk that was never fetched while online. This matches the owner's
symptom exactly. The 2026-06-20 architecture review (archived) explicitly flagged the missing
offline fallback and it was never built; the whole shell layer has no owner in the current
backlog (R3 and the home/health items cover *data*, not the shell).

## Reproduction (production build, real server-down offline)

Scenario: sign in, use the app normally online (land on `/`, let nav prefetch run), then go
offline.

| Step | Result |
|---|---|
| SW cache contents after normal online use | Documents: **only `/` and `/sign-in`**. Tabs exist only as per-build RSC payloads (`/workout?_rsc=ZmCQ…`, `/health?_rsc=…`, etc.) + 59 static chunks that happened to load |
| Offline **cold start at `/`** | ✅ **200, home renders fully** from SW cache + `readCacheSync` seeds |
| Offline **warm tab-tap → /workout** | ⚠️ RSC payload served from cache, URL changes, then **`Loading chunk 6619 failed`** (lazy chunk never fetched online) → error boundary "Something went wrong", **bottom nav gone** — app dead-ends |
| Offline **cold start at `/workout`** | ❌ **`net::ERR_FAILED`** — `caches.match` misses, `respondWith(undefined)`, raw Chromium error page |
| Document `Cache-Control` (measured) | `private, no-cache, no-store, max-age=0, must-revalidate` — the WebView HTTP cache holds **nothing**; SW Cache Storage is the single point of failure |

On the S25 the failure is at least this bad. Cold start lands on `/` (Capacitor `server.url`
root), so the killer paths are: (a) **a deploy happened during the user's last online use** —
see F2 below, the cache is wiped and only partially re-fills; (b) any warm navigation to a tab
whose lazy chunks weren't all fetched this build; (c) any cold start after (a) before every
route was re-visited online. Given this project deploys to `main` multiple times a day, the
post-deploy wiped-cache state is close to the *normal* state of the device.

## Findings — app shell (the outage class)

**F1 — No offline fallback of any kind.** `public/sw-template.js:106-115` is network-first with
`.catch(() => caches.match(e.request))`; a miss resolves `undefined` → Chromium error page. No
precached offline page, no `onReceivedError` in `MainActivity`, no offline route. (Flagged in
`docs/superpowers/plans/archive/2026-06-20-offline-first-architecture-review.md:205` and never
built.)

**F2 — Every deploy wipes the entire offline cache.** The cache name is build-stamped
(`app/sw.js/route.ts:14`); the activate handler deletes every other cache
(`sw-template.js:12-13`) while `install` precaches nothing (`:3-8` — deliberate, because
authed pages can't be prefetched without cookies; but that reasoning only holds for
*documents*, not static assets). After each deploy, offline coverage resets to "whatever was
visited since". RSC cache keys (`?_rsc=<hash>`) also rotate per build.

**F3 — Static chunks are cached only if they happened to load.** `_next/static` is cache-first
(`sw-template.js:92-104`) but never pre-populated, so lazy chunks (`next/dynamic`, per-route
bundles) of not-yet-visited screens are missing offline → the `Loading chunk failed` dead-end
above. These files are content-hashed and immutable — they are the one thing that *could* be
precached exhaustively and cheaply.

**F4 — A failed navigation has no graceful client-side handling.** When an offline RSC fetch
fails, Next hard-navigates (full document request) which also misses; when a chunk fails, the
error boundary (`app/error.tsx`, `app/workout/error.tsx`) renders **without the bottom nav**
and its "Go to home" link is itself another RSC navigation that can fail. No
`navigator.onLine`/Capacitor-Network state reaches the shell UI — **the app has no offline
indicator anywhere** (the only listener, `components/sync-provider.tsx:147-154`, silently
re-drains the outbox on reconnect).

**F5 — The SW page handler caches every response unconditionally.** `sw-template.js:107-112`
`cache.put`s without checking `res.ok` — a 500, a maintenance page, or a redirect response
poisons the cache for that URL until the next successful online visit.

**F6 — activate force-reloads every open client** (`sw-template.js:15-16`,
`client.navigate(client.url)`): after each deploy, the app reloads out from under the user
(mid-workout included), and that reload is what re-caches `/` — coupling F2's recovery to a
disruptive UX.

**F7 — Nothing verifies the SW is actually alive in the Samsung WebView.** Registration is a
fire-and-forget `.catch(() => {})` (`components/service-worker-registration.tsx:8`). If SW
registration fails on-device (WebView version/storage eviction), offline coverage is zero and
nothing reports it. This review's repro ran in desktop Chromium; **on-device behaviour was NOT
exercised this session** (no device in the sandbox) — the fix plan includes an on-device
verification step.

## Findings — data layer (works, with bounded gaps)

Verified: `cachedFetch` never throws offline (`lib/sqlite/cache.ts:237-249` swallows network
failure; cached data already surfaced via `onData`), `SyncProvider` never blocks paint and
backs off cleanly offline, and every primary screen (home, workout, nutrition, health, stats)
seeds synchronously from `readCacheSync` and/or reads the native local store first
(`getLocalStore` — the supplements/nutrition/health patterns). Remaining gaps, none of which
explain "pages would not load":

**D1 — Today-guarded keys blank after midnight offline.** The six date-enveloped keys
(readiness, body-battery, training-load, weekly-stats, progress-summary, health-trends;
`lib/sqlite/cache.ts:292-296`) treat yesterday's value as a miss after local midnight even
offline — correct for the "never serve yesterday as today" rule, but offline it means those
widgets go blank rather than showing anything.

**D2 — The offline read window is ~24 h.** localStorage seeds are TTL-floored to 24 h
(`cache.ts:106`); the native `api_cache` layer expires at the real TTL (5 min–6 h,
`cache.ts:95`). Past ~24 h fully offline, cache-seeded (non-local-store) widgets blank.

**D3 — Secondary surfaces are bare `fetch` with no seed/local fallback** — day-log detail
sheets (home week overlay, health/stats day overlay), HR-recovery, exercise history, AI
surfaces: spinner-then-nothing offline. Mostly already owned by queued items (see dedupe
table).

**D4 — No offline indicator** (same as F4's UI half): stale data renders with no cue that the
app is offline or how old the data is.

## Dedupe against the existing queue

| Finding | Owned by existing item? |
|---|---|
| F1–F7 (shell) | **Nobody** — new plan (this review's companion) |
| D1, D2, D4 | **Nobody** — folded into the new plan (chunk 3) |
| D3 day-log sheets / home server-only reads | Item 8 (home freshness) chunk 3, R3 chunks 2–3 |
| Sleep-detail server-only read, injuries write path | Item 10 (health overhaul) chunk 5 |
| Outbox/write-path offline integrity | R3 (item 11) — unchanged, not re-audited here |
| Bundle-shell-into-APK + native FCM endgame | Existing unplanned backlog note — the new plan is the interim step and strengthens that case |

## Companion plan

`docs/superpowers/plans/2026-07-11-offline-shell-availability.md` — queued as a new top-priority
backlog item. Summary: precache the full immutable static-asset set per build at SW install;
retain the previous cache generation across deploys instead of wiping; add a precached,
unauthenticated `/offline` fallback page + navigation fallback chain (exact match → `/` →
`/offline`); guard `cache.put` on `res.ok`; give the shell an offline indicator and make the
error boundary offline-aware (keep the bottom nav, detect `navigator.onLine`); extend the
offline read window; and an on-device airplane-mode smoke checklist as the merge gate.

## What was NOT exercised in this review

Per the Canonical Runtime rule: everything above was verified in desktop Chromium against a
local production build. **Not exercised:** the Samsung S25 WebView (SW registration health,
actual on-device offline behaviour), native SQLite local-store reads (web sandbox has no
Capacitor), a real Railway deploy cycle (F2's cache wipe was verified by reading the activate
handler, not by cycling deploys), and real airplane-mode radio behaviour. The plan's final task
is the on-device verification pass.
