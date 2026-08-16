# Offline-Feel / Perceived-Latency Review — why the app doesn't feel native yet

**Date:** 2026-07-11 (session 275) · **Audited at:** `main` (post v1.129.1; reconciled post-merge against v1.130.1 — see the update note below)
**Owner question:** "With the offline local DB I expected the app to always feel like a native
app — tap a tab and it loads instantly, all data shown instantly, writes update tiles
instantly. Instead: opening the app takes a few seconds, widgets take a moment, and tab
navigation has a ~1 s delay. Are the queued backlog items all that's needed to fix this, and
if not, why is it laggy and how do we fix it?"

**Method:** static code review of the full navigation, startup, and per-screen data paths
(three parallel sweeps, key findings hand re-verified), plus a coverage reconciliation against
every queued backlog item. **Nothing was timed on-device this session** — see §7.

> **Reconciliation update (same day, post-#430/#431):** while this review was in flight, the
> **offline-shell SW rework shipped (v1.130.0)** and the **home-freshness chunks 1+2 shipped
> (v1.130.1)**. Both are reflected below: the SW now precaches, retains the previous cache
> generation across deploys, and has an `/offline` fallback (START-4 fixed) — but online
> documents remain **network-first** (verified against the landed template), so START-2 and
> the whole of Layer A stand. Home's dead Cloud syncs, dead streak stamp and redundant
> `calendar-data` fetch (HOME rows in §6) are now fixed; home chunks 3–5 remain queued.
> Item numbers reflect the post-session-275 queue.

---

## 1. Verdict — the queue is necessary but NOT sufficient

The queued/shipped batches (the offline-shell fix — shipped v1.130.0 — plus items 8, 10, 15/R6, 18 and R5) fix the **data layer**: per-screen cache
seeding, skeleton flashes, dead optimistic updates, fetch storms, and offline *availability*
of the shell. All of those findings were re-verified as still live and correctly owned — that
work should proceed.

But the two **dominant** latency sources the owner is describing are structural and are
**not owned by any queued item**:

1. **Every bottom-nav tab tap performs a network round-trip to Railway before the new screen
   can mount** (§2). The local SQLite cache seeds the screen *after* that round-trip; it
   cannot mask it. This is the ~1 s tab delay, and no queued item touches it.
2. **Every app open blocks on a network-first document fetch to Railway before anything
   paints** (§3). The offline-shell fix (shipped v1.130.0) covers the *offline* failure mode
   but deliberately keeps online loads network-first — so the "few seconds to open" symptom
   survives it unchanged (verified against the landed SW template).

In short: the app's data is offline-first, but its **shell and navigation are still a remote
website**. Until the RSC round-trip is taken off the tab-tap path and the document load is
served cache-first, the app will feel like a high-latency web page no matter how good the
per-screen caching gets. §5 lays out the fix packages; §6 is the coverage map.

---

## 2. Layer A — tab navigation: the ~1 s tap delay (NOT covered by any queued item)

### The causal chain on every bottom-nav tap

```
tap → hapticLight() → e.preventDefault() → router.push(href)        [components/shell/bottom-nav.tsx:39-47,
                                                                      lib/navigate-with-transition.ts:13-15]
    → App Router client navigation to a DYNAMIC route
    → RSC fetch over the network:  GET https://<railway>/<tab>?_rsc=…
        → service worker: NETWORK-FIRST for documents/RSC — always blocks on Railway
                                                                      [sw-template.js final pages handler]
        → middleware edge JWT check (matcher doesn't exclude ?_rsc)   [middleware.ts:27-29]
        → server render: await auth() per tab; /more also does a Postgres query
    → RSC payload returns → client component mounts
    → useLayoutEffect seeds synchronously from cache → paint          [e.g. session-select-content.tsx:237-322]
```

The cache-seed step at the end is healthy and fast. Everything above it is the problem: the
route **cannot mount** until a full round-trip to Railway completes, and with no visual
feedback in between, the old screen sits frozen — which reads as "the app is laggy".

### Findings

- **NAV-1 — all five tab routes are dynamic server components.** Each `page.tsx` is `async`
  and does `await auth()` (a `cookies()` read → the route can never be static):
  `app/page.tsx:7-9`, `app/health/page.tsx:7-9`, `app/workout/page.tsx:12-16`,
  `app/nutrition/page.tsx:7-9`, `app/more/page.tsx:10-19`. Consequence: every client-side
  navigation is an RSC network fetch. `auth()` itself is a JWT decode (no DB) — the cost is
  the round-trip, not the server work.
- **NAV-2 — the router cache is configured to discard everything (the single biggest lever).**
  `next.config.ts` sets no `experimental.staleTimes`, so Next 15's default
  `staleTimes.dynamic = 0` applies: the client router cache treats every dynamic route's
  payload as stale **immediately**. The bottom nav's `<Link prefetch>` (bottom-nav.tsx:69,94)
  duly prefetches every tab, and then the tap re-fetches anyway because the prefetched entry
  is already "stale". Revisiting a tab you were on 5 seconds ago = another full round-trip.
  (Default semantics inferred from Next 15 docs — verify empirically at implementation, §7.)
- **NAV-3 — the service worker gives navigations no fast path.** The final pages handler in
  `public/sw-template.js` is network-first (still true of the shipped v1.130.0 rework): it always awaits the network and uses the
  cached copy only on failure (offline). Online, the SW adds zero latency benefit to the hot
  path by design.
- **NAV-4 — no `loading.tsx` exists anywhere in `app/`.** So there is no instant skeleton on
  navigation: the previous screen stays frozen for the entire round-trip. Even with NAV-1/2
  unfixed, a loading boundary would make taps *feel* instant (nav responds on the tap frame).
- **NAV-5 — `/more` does a real Postgres query per navigation.** `app/more/page.tsx:13-14`
  calls `getRepository()` + `repo.getUserByEmail()` server-side on every visit — the only tab
  with a DB round-trip in its render path (DB latency added on top of the RSC round-trip).
- **NAV-6 — confirmed fixed / not the cause:** the View-Transition wrapper was removed in
  session 252 (`lib/navigate-with-transition.ts` is a plain `router.push`), and the workout
  screen's repaint-on-open (UB7) shipped. The residual delay is pure network.

---

## 3. Layer B — app open: the "few seconds" cold start (partially covered by the shipped offline-shell fix)

The APK is a **remote WebView** (`capacitor.config.ts:9` — `server.url` points at Railway, no
bundled assets). Ordered cold-start timeline with costs:

1. **Blank `#09090b` screen** — no `@capacitor/splash-screen` plugin is installed at all, so
   the entire load is an unbranded dark void. *(START-3 — cheap perceived-latency win,
   uncovered.)*
2. **Document fetch, network-first** (the SW's final pages handler): even with a fully warm
   SW cache, **nothing paints until a full round-trip to Railway completes** — the cached
   document is only used offline. *(START-2 — the largest single cost; NOT covered: the
   shipped v1.130.0 rework adds precache/offline-fallback but keeps online loads
   network-first.)*
3. Server render: middleware + layout + page `auth()` (3 JWT decodes, no DB — fine).
4. **JS chunks**: cache-first from the SW (instant when warm) — but the cache name is
   build-stamped and old caches are deleted on activate, so **the first open after every
   deploy re-downloads the entire bundle**, and the activate handler force-navigates open
   clients. *(START-4 — ✅ SHIPPED v1.130.0: previous-generation retention landed and the
   force-reload was dropped.)*
5. Hydration of the home bundle, then `useLayoutEffect` cache seeds → first meaningful paint.
   Fast when caches are warm.
6. **Post-paint startup stampede:** `SyncProvider` (components/sync-provider.tsx:83-137)
   fires SQLite init + ~20 cache-mirror reads, then `pushMutations` + `pullDelta`, then ~20
   warm fetches (chunked 5-at-a-time), while the home screen fires its own ~14 fetches and
   `maybeSyncOura` runs — **~35-40 near-simultaneous requests** to a distant server competing
   for bandwidth right when the user starts interacting. *(START-5 — uncovered except the
   home dead-Oura-sync subset, which shipped in v1.130.1; the stagger remains open.)*
7. **Home bundle size:** `app/session-select/session-select-content.tsx` is 1,515 lines and
   statically imports ~6 sheets + many Radix primitives; `motion` is in the always-loaded
   shell. chart.js/katex correctly stay out of the home tree. *(START-6 — partially covered:
   R6 PERF-1/PERF-12 and item 8 Task 4.2 split some of it; a broader sheet code-split is
   uncovered but secondary.)*
8. `initSQLite`/`reconcileSchema` does one `PRAGMA table_info` per registered column over the
   Capacitor bridge (`lib/sqlite/sqlite-service.ts:60-105`) — chatty; delays *fresh* data,
   not first paint. *(START-7 — minor, uncovered.)*

**Resume** (WebView alive) is already light — `SyncProvider`'s heavy effect is keyed on
`userId` and does not re-run; only the Oura freshness check + reminder reconciles fire. If
resume feels as slow as cold start, Android killed the WebView and it's a real cold start —
which makes the cold-start fixes above the same fix for "resume".

---

## 4. Layer C — per-screen data paint & write→tile updates (mostly covered; 3 new findings)

The per-screen audit re-verified the queued findings as still live (none silently shipped) and
correctly owned — summarized in §6. The instant-paint architecture itself is sound: every main
screen seeds synchronously in a `useLayoutEffect` and paints cached data on the next frame.
The gaps are the known per-widget exceptions (un-seeded `weekly-stats`/supplements, the
freshness-gated Body-tab skeleton wall, `loading:` skeletons on cache-seeded dynamic cards,
the dead post-workout streak stamp [since fixed — v1.130.1], nutrition date-swipe storm,
un-memoized card fleets) — owned by items 8 / 10 / 15(R6) / 18; home's chunks 1+2 shipped
v1.130.1 while this review was in flight, its chunks 3–5 remain queued.

### New findings — not owned by any queued item

- **NEW-1 (high) — More-tab pull-to-sync nukes the entire app cache.**
  `app/more/more-content.tsx:93` calls `invalidateCache('')` — the empty prefix matches every
  cache key app-wide and wipes all sessionStorage/localStorage mirrors
  (`lib/sqlite/cache.ts:133-143`). One pull on the More tab destroys every instant-paint seed,
  so the next visit to Home/Health/Nutrition/Workout is back to skeletons + full refetch —
  i.e. the app periodically *reverts itself* to the exact laggy state this review is about.
  The identical pattern was fixed on health-content in the 2026-07-03 quick-fixes pass
  (targeted `invalidateOuraSync/Biometrics/HealthTrends` at `health-content.tsx:477`); the
  More instance was never enumerated. Fix: mirror health's targeted invalidation.
- **NEW-2 (medium) — More-tab pull-to-sync still fires the dead Oura Cloud sync,
  unconditionally.** `more-content.tsx:86-91` POSTs `/api/oura/sync` (frozen since the
  re-key) with no BLE-freshness gate. The data-mapping item's Chunk 4 gated the
  sync-provider/health call sites but explicitly left More as the "manual fallback" without
  assigning the planned 48 h gate to it; item 8 scopes only home-surface call sites. Needs the
  same `isBleDataFresh` gate (and ideally a ring `drainHistory()` instead, matching item 8's
  home rewiring).
- **NEW-3 (low) — `ConfigScreen` loads blank.** `app/more/more-content.tsx:19` dynamic-imports
  it `ssr:false` with no loading fallback → the More→Workout sub-tab shows a blank frame
  while the chunk loads.

---

## 5. What to build — recommended fix packages (input for the implementation plan)

> **Update (same session, 275):** P1–P3 are now planned and queued — plan
> `docs/superpowers/plans/2026-07-11-instant-nav-and-app-open.md`, **backlog item 3**
> (branch `perf/instant-nav-app-open`). P4 remains the unqueued Track A endgame bullet.
> Item numbers throughout this doc reflect the post-insertion queue numbering.

Ordered by leverage-per-effort. P1 + P3 are small and would remove most of the *perceived*
lag; P2 rides on the shipped v1.130.0 SW rework; P4 is the endgame.

### P1 — Instant tab navigation (small; the headline win)

1. **Configure the router cache:** `experimental.staleTimes = { dynamic: 300 }` (or similar)
   in `next.config.ts`. Tab payloads are auth-gating shells — all *data* renders client-side
   from the local cache — so reusing a minutes-old RSC payload is safe by construction here.
   With the bottom nav's existing `prefetch={true}`, warm tab-to-tab taps should become
   **zero-network** client transitions. This is the single biggest lever; verify on-device
   (Samsung WebView) that taps stop issuing `?_rsc=` fetches.
2. **Add `loading.tsx` to the five tab routes** rendering the screen's shell (header +
   bottom nav + content skeleton) so any navigation that *does* hit the network responds on
   the tap frame. This is the backstop for cold router-cache cases (first tap after open,
   post-deploy) — nav must never feel inert.
3. **Take the Postgres query off `/more`'s render path** (`app/more/page.tsx:13-14`): move
   the user fetch into `more-content` via `cachedFetch` (seeded, like every other tab) or
   carry the needed fields in the JWT, matching the session-252 `/health` precedent.
4. Optional, evaluate during P1: exclude `?_rsc=` prefetches from `middleware.ts`'s matcher
   (minor), and consider an SW stale-while-revalidate branch for `?_rsc=` requests as a
   belt-and-braces fast path if `staleTimes` alone proves insufficient on the WebView. Note
   any SWR-served RSC/document must be same-build — guard with the build-stamped cache the SW
   already uses, or skip serving stale across a build change (the shipped generation-retention
   logic already tracks this boundary).

### P2 — Fast app open (extends the shipped v1.130.0 SW rework)

1. **Serve the app-shell document cache-first-with-revalidate when a warm same-build cache
   exists** instead of always network-first: paint the cached document immediately, refresh
   behind. Falls back to network-first when the cached copy predates the current build (the
   SW's build-stamped cache name makes this detectable). This converts the "few seconds"
   online cold start into a near-instant paint + background refresh. It belongs in the same
   `sw-template.js` structure the v1.130.0 rework established (precache, generation retention,
   offline fallback) — the plan's Task 8 is written directly against it.
2. **Install `@capacitor/splash-screen`** so cold start shows branding instead of a black
   void until first paint (requires an owner APK rebuild — batch with the next native
   rebuild).
3. **Stagger the startup stampede:** delay `SyncProvider`'s Phase-3 warm-fetch fan-out (~20
   requests) a few seconds so the visible screen's own fetches win the bandwidth race;
   the reminder reconciles + step-orchestrator mounts can also defer. Keep push/pull prompt
   (data integrity) — it's the *warm* traffic that can wait.
4. Low priority: batch `reconcileSchema`'s per-column `PRAGMA table_info` calls into one
   `table_info` read per table (`lib/sqlite/sqlite-service.ts:93-99`).

### P3 — More-tab fixes (tiny; NEW-1/2/3 from §4)

Targeted invalidation groups instead of `invalidateCache('')`; BLE-freshness-gate (or
replace) the Cloud sync call; a loading fallback for `ConfigScreen`.

### P4 — Endgame: the shell stops being remote (existing unqueued Track A)

P1/P2 make the remote shell *feel* native almost always, but the ceiling remains: a WebView
whose document, chunks, and RSC payloads live on a server can never be fully
network-independent. The real native-feel endgame is the already-documented
**bundle-the-shell-into-the-APK + native FCM** project (2026-07-06 review §9 Track A, listed
under "Not yet queued" in the backlog: cross-origin cookie auth, `apiUrl()` sweep, de-SSR of
the page layer). A cheaper intermediate variant worth weighing in that planning session: keep
the remote origin but collapse the five tabs into a single client-side shell (one route,
tabs as client state) so tab switching stops involving the router entirely. P1 approximates
this for far less effort; P4 is where "always instant, even with no reception, even
post-deploy" actually lives.

### Sequencing note

P1 and P3 are independent quick wins — they can land immediately. P2's SW half is written
against the offline-shell rework that shipped as v1.130.0 (the coordination concern this
section originally carried is resolved — the plan's Task 8 targets the landed template).
The per-screen queue (items 8, 10, 15, 18) proceeds unchanged; P1–P3 don't overlap it.

---

## 6. Coverage map — symptom → owner

| Symptom / cause | Owned by (queued) | Gap |
|---|---|---|
| ~1 s tab-tap delay (RSC round-trip: NAV-1..5) | **nothing** | **P1** |
| No visual response on tap (no `loading.tsx`) | nothing | **P1.2** |
| App open blocks on network even with warm cache (START-2) | shipped offline-shell fix covers *offline* only | **P2.1** |
| Blank unbranded screen during open (START-3) | nothing | **P2.2** |
| Post-deploy full re-download + force-reload (START-4) | ✅ shipped v1.130.0 (retention, force-reload dropped) | — |
| Startup request stampede (START-5) | home dead-Oura-sync subset ✅ shipped v1.130.1 | **P2.3** (stagger) |
| Home bundle monolith (START-6) | R6 PERF-1/12 + item 8 Task 4.2 (partial) | rest is secondary |
| Home: dead streak stamp, legacy seeds, dead Cloud syncs, `calendar-data` dupes | ✅ shipped v1.130.1 (item 8 chunks 1+2) | — |
| Home: local-first reads, un-memoized cards, sheet extractions | ✅ item 8 chunks 3–5 (+ R6 PERF-6/7) | — |
| Health: `weekly-stats` unseeded, 13-skeleton Body wall, `fetchMeta` waterfall, 5 `loading:` skeletons, 4× trends fetch | ✅ item 10 + R6 PERF-4/6/7 | — |
| Nutrition: supplements unseeded, date-swipe storm + blank flash, sheet bare-fetches, `MealCard` memo | ✅ item 18 + R6 PERF-5 | — |
| Workout: repaint-on-open (UB7), stale `programSessionId` | ✅ shipped (v1.124.5/6, v1.129.1) | — |
| More: `invalidateCache('')` app-wide nuke; ungated Cloud sync; blank ConfigScreen | **nothing** | **P3** |
| Structural ceiling: remote shell | unqueued Track A bullet | **P4** planning session |

---

## 7. Not exercised / verify at implementation

- **Static review only — no on-device or in-browser timing was performed.** The attribution
  of the ~1 s to the RSC round-trip is causal-chain analysis, not a measured trace. First
  implementation step for P1 should be a quick before/after check on the S25 (or remote
  devtools) confirming each tab tap currently issues a `?_rsc=` request and that the fix
  removes it.
- **Next 15 `staleTimes` semantics** (NAV-2) are inferred from documented defaults; confirm
  the prefetch-reuse behaviour empirically, on the Samsung WebView specifically.
- Railway↔device RTT assumed high (AU user, region unconfirmed) — worth one `curl -w` check;
  if the region is wrong, moving the Railway region is a free multiplier on everything above.
- Per CLAUDE.md, all paint/feel claims are only truly judged on the S25 APK; the web sandbox
  renders none of the native surfaces.
