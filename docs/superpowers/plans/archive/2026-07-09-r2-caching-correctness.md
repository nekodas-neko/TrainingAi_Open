# R2 — Caching Correctness (CACHE-F1…F17)

**Source review:** `docs/reviews/2026-07-06-full-app-overview-review.md` §2 (batch **R2**).
**Branch:** `fix/caching-correctness`. **Server/JS-only** — every change is client cache
plumbing (`lib/cache-groups.ts`, `lib/cache-ttl.ts`, `lib/sqlite/cache.ts` call sites) plus
a handful of route `Cache-Control` headers; ships via Railway into the WebView with **no APK
rebuild**, and every fix is exercisable against `pnpm dev` + the local dev DB. **One APK-only
path — CACHE-F6 (native quick-log body-metric write in `session-select-content.tsx`) — cannot
be exercised in the sandbox** (`getLocalStore` returns null on web, so the device branch never
runs); it is compile/logic-verified only and flagged **device-verify** below.

**Goal:** eliminate the caching-correctness defects in §2 — one clobbering variant mismatch,
several hard-staleness date-less caches, missing invalidation-group registrations, ad-hoc
key lists at write sites, TTL/key duplication, and missing SWR headers — so every cached
surface invalidates through a named group and never serves yesterday's or pre-write data.

**Governing CLAUDE.md rules** (the "Cache Invalidation" block): *writes go through cache groups,
never hand-rolled key lists*; *one canonical TTL per cache key*; *one fetch variant per key*
(`cachedFetch` vs `cachedFetchToday`, converting every read site **and the sync-provider warm
list** together); *`freshWithinTtl: true` requires a written invalidation proof*; *any cache
holding "today's" data must embed/validate the local date*; *never create a bare key that is a
prefix-sibling of an existing group prefix*; *new aggregate GET routes ship SWR headers at
creation*; *client GETs of `/api/*` use `cachedFetch` with a `readCacheSync` seed, never bare
`fetch`*.

**Verification status of the 17 findings:** all 17 re-confirmed present on current `main`
(2026-07-09); line numbers below are updated to current code. Two sub-claims narrowed — see the
notes on F12 and F14. Nothing was already fixed.

---

## Chunk 1 — Clobbering variant mismatch (CACHE-F1, critical)

**CACHE-F1** — `progress-summary` is fetched with **two different `cachedFetch` variants**, whose
stored shapes clobber each other (the weekly-stats-crash class). `cachedFetchToday` stores a
`{ date, data }` envelope; plain `cachedFetch` stores the raw payload. When the nutrition screen
writes the raw shape and the health screen reads it back through `unwrapToday`, `envelope.date`
is `undefined` → treated as a miss → permanent no-hit; the reverse makes health's `d.foo` read
`undefined`.

Current sites:
- `app/health/health-content.tsx:371` — `cachedFetchToday<ProgressSummaryResponse>('progress-summary', …)` (canonical envelope shape).
- `app/health/health-content.tsx:251` — seed via `readTodayCacheSync<ProgressSummaryResponse>('progress-summary')` (envelope-aware).
- `components/sync-provider.tsx:41` — warm-list entry `{ key: 'progress-summary', …, today: true }` (envelope shape).
- `app/nutrition/nutrition-content.tsx:223-226` — **plain** `cachedFetch<ProgressSummaryResponse>('progress-summary', …)` ← the offender.

1. **Convert the nutrition read site to `cachedFetchToday`** — `app/nutrition/nutrition-content.tsx:223-226`:

   ```ts
   cachedFetchToday<ProgressSummaryResponse>(
     'progress-summary', '/api/progress-summary', TTL_MEDIUM,
     d => setWeightRateKgPerWeek(d?.weightRateKgPerWeek ?? null),
   ),
   ```
   Import `cachedFetchToday` in that file's `@/lib/sqlite/cache` import (currently
   `cachedFetch, readCacheSync, isBodyMetadataFresh`).

2. **No `readCacheSync('progress-summary')` seed exists in nutrition** (the seed block at
   `nutrition-content.tsx:90-100` seeds meal-types/food-logs/targets/weekly/adherence/body-metadata
   only), so there is no synchronous seed to convert — but confirm during implementation that none
   is added; if a seed is ever added it must use `readTodayCacheSync`.

3. **Sync-provider warm list already uses `today: true`** (line 41) — no change; this task exists
   only to note the invariant (all three envelope sites already agree; nutrition was the lone
   raw-shape reader).

**Verify:** `pnpm dev`; log a body-weight change so `weightRateKgPerWeek` shifts, then hop
Nutrition ↔ Health without a reload — both read the same envelope, neither shows `undefined`/blank
weight-rate. Confirm `ta_sscache:progress-summary` in sessionStorage holds `{date,data}` after the
nutrition screen fetches (previously it held the raw payload). CLAUDE.md: *one fetch variant per key*.

---

## Chunk 2 — Hard-staleness date-less caches (CACHE-F3, CACHE-F4, high)

Both keys here are `TTL_LONG` and, for F3, read with `freshWithinTtl: true` — so a stale value is
served for up to 6 h with the network skipped entirely.

### CACHE-F3 — phase-set CRUD invalidates only `phase-sets`

Phase sets feed `phaseStatus`/`phaseName` rendered under the `workout-card:<id>` key (TTL_LONG,
fetched with `freshWithinTtl: true`). Invalidating only `phase-sets` leaves the phase labels on
every pre-workout card hard-stale for 6 h after an edit.

Current offenders — `components/config-screen.tsx` `invalidateCache('phase-sets')` at lines
**260, 298, 318, 330** (create-from-fetch, upsert, reorder, delete). The file already imports and
uses `invalidateProgramStructure` (line 15) at the program/style paths (193, 214, 495, 516, 535,
557), and that group already contains both `phase-sets` **and** `workout-card:` (`lib/cache-groups.ts:84-85`).

1. Replace each of the four `await invalidateCache('phase-sets')` calls with
   `await invalidateProgramStructure()`. No import change (already imported).

**Verify:** `pnpm dev`; edit a phase set in Config, return to the session-select pre-workout cards —
the phase label updates immediately (previously stale ≤6 h). CLAUDE.md: *writes go through cache
groups*; *`freshWithinTtl: true` requires a written invalidation proof*.

### CACHE-F4 — `workout-data:` / `workout-card:` cache a server-computed "today" flag under a date-less key

`app/api/workout-data/route.ts:347` stamps `loggedTodayInSession: loggedTodayInThisSession.has(…)`
per exercise; the response (line 358: `{ exercises, program, session, phaseStatus }`) is cached
under the date-less `workout-data:<tab>` / `workout-card:<id>` keys at `TTL_LONG`. Consumers act on
`loggedTodayInSession` straight from cache with **no date validation**, so crossing midnight shows
yesterday's "trained today" until the network refetch lands.

Consumers of `loggedTodayInSession`:
- `app/workout-select/workout-select-content.tsx:31-35` (seed read → "Trained today" label)
- `components/workout-screen.tsx:1085` (first-unlogged-exercise index)
- `components/workout/pre-workout-screen.tsx:113, 207, 354`
- `components/workout/done-screen.tsx:170`

The payload also carries slow-changing structural data (exercise list, phase status) we **want**
to instant-paint across midnight, so converting the whole key to `cachedFetchToday` is wrong (it
would discard the exercise list nightly). Fix with a **field-level date guard**, mirroring
`isBodyMetadataFresh` — stamp the payload's build date server-side and treat `loggedTodayInSession`
as `false` when that date isn't today.

1. **Stamp the response date** — `app/api/workout-data/route.ts:358`. The route already computes
   the user's timezone for `getDayLog`; return it:

   ```ts
   return NextResponse.json(
     { exercises, program, session: programSession, phaseStatus: sessionPhaseStatus, dataDate: todayStr },
     { headers: cacheHeaders },
   );
   ```
   where `todayStr` is the same user-local `YYYY-MM-DD` already used to build
   `loggedTodayInThisSession` (reuse it — do not recompute with `toISOString()`). Add `dataDate: string`
   to the response type interface near line 56.

2. **Shared read guard** — add to `lib/sqlite/cache.ts` next to `isBodyMetadataFresh`:

   ```ts
   // workout-data/workout-card payloads carry a server-stamped `dataDate`; the per-exercise
   // `loggedTodayInSession` flag is only meaningful when that build date is today (the key is
   // date-less + TTL_LONG, so a cached payload survives past midnight). A payload with no
   // dataDate (older cache entry) is treated as not-today — the flag falls back to false.
   export function isWorkoutDataToday(data: { dataDate?: string } | null | undefined): boolean {
     return data?.dataDate === todayInTz();
   }
   ```
   (Thread the session tz only if a consumer already has it; the existing consumers use the
   default-tz `todayInTz()`, matching how the label code compares dates today.)

3. **Guard each consumer** — treat `loggedTodayInSession` as `false` unless `isWorkoutDataToday(payload)`:
   - `workout-select-content.tsx:35`: `if (isWorkoutDataToday(data) && exercises.some(e => e.loggedTodayInSession)) return "Trained today";`
   - `workout-screen.tsx:1085`, `pre-workout-screen.tsx:113/207/354`, `done-screen.tsx:170`: gate the
     `ex.loggedTodayInSession` term on the payload's freshness (each has the parent payload in scope;
     compute `const freshToday = isWorkoutDataToday(workoutData)` once and use
     `(freshToday && ex.loggedTodayInSession)`).

**Verify:** `pnpm dev`; seed a `workout-data:<tab>` cache with `loggedTodayInSession:true` and a past
`dataDate` (or set the clock forward), reload the pre-workout screen — no exercise shows "done today"
from cache; the network refetch (fresh `dataDate`) restores the correct state. Boundary-test at
23:59→00:01 user-local. CLAUDE.md: *any cache holding "today's" data must embed the local date in its
key (or validate the date on read)*.

---

## Chunk 3 — Missing invalidation-group registrations (CACHE-F2, F5, F6, F8, F10, F11, high/med)

Each of these is a write whose group (or hand-rolled list) omits a key the write actually changes.

### CACHE-F2 — log-exercise write uses a hand-rolled key list (= WK-5)

`components/workout-screen.tsx:853-857` (the per-set log path) invalidates an ad-hoc list —
`weights-summary`, `weekly-stats`, `muscle-recovery`, `strength-trend`, and
`workout-card:<programSessionId>` — plus `invalidateCalendarCache()` at 852. It **misses**
`exercise-history:<name>`, `day-log:`, `home-day-timeline`, `achievements:`,
`workout-sessions-day:`, `calendar-data:`/`streak-data`, `training-load`, `muscle-tonnage-trend`.
These are only cleared on full workout **completion** via `invalidateWorkoutSummaries()` (line 995),
so a solo re-log mid-session leaves Health/Home stale.

1. **New group in `lib/cache-groups.ts`:**

   ```ts
   /** Caches that change when a single exercise is logged mid-session (not a full
    *  workout completion). Superset of the ad-hoc list previously inlined in
    *  workout-screen; the completion path still calls invalidateWorkoutSummaries(). */
   export async function invalidateExerciseLogged(programSessionId?: string, exerciseName?: string): Promise<void> {
     await Promise.all([
       invalidateCache('weights-summary'),
       invalidateCache('weekly-stats'),
       invalidateCache('muscle-recovery'),
       invalidateCache('strength-trend'),
       invalidateCache('exercise-history:'),        // prefix — all exercises (cheap; re-log affects history)
       invalidateCache('day-log:'),
       invalidateCache('home-day-timeline'),
       invalidateCache('achievements:'),
       invalidateCache('workout-sessions-day:'),
       invalidateCache('calendar-data:'),
       invalidateCache('streak-data'),
       invalidateCache('training-load'),
       invalidateCache('muscle-tonnage-trend'),     // see F10 — also added to invalidateWorkoutSummaries
       ...(programSessionId ? [invalidateCache(`workout-card:${programSessionId}`)] : []),
     ]);
   }
   ```
   (`exerciseName` is accepted for call-site symmetry with WK-5's intent; the prefix invalidation of
   `exercise-history:` covers it without needing the name — keep the param but the body may ignore it,
   or narrow to `exercise-history:${exerciseName}` if preferred. Prefer the prefix: a re-log can shift
   PR/1RM history for the same exercise under its own key only, but the cheap prefix wipe is simplest
   and matches `invalidateWorkoutSummaries`.)

2. **Call it at `workout-screen.tsx:853-857`** — replace the five inlined `invalidateCache(...)` calls
   with `invalidateExerciseLogged(programSessionId, /* exerciseName if in scope */)`. Keep the
   `invalidateCalendarCache()` line only until Chunk 7/F14 removes it.

**Verify:** `pnpm dev`; start a workout, log one exercise, navigate to Health without completing — the
day-log/achievements/exercise-history reflect the new set immediately. CLAUDE.md: *never call
`invalidateCache()` with an ad-hoc list of keys at a write site*.

### CACHE-F5 / meal-type context — `nutrition-adherence` in no group (= NUT-6)

`nutrition-adherence` (fetched at `nutrition-content.tsx:215-218`, seeded at :98) is absent from
`invalidateNutritionWrite()` (`lib/cache-groups.ts:182-193`), and meal-type CRUD
(`components/nutrition/meal-type-manager.tsx:90, 107, 125, 150`) invalidates only
`nutrition-meal-types`. Adherence depends on **both** food logs and meal-type definitions, so it goes
stale ≤30 min after either write.

1. Add `invalidateCache('nutrition-adherence')` to `invalidateNutritionWrite()`
   (`lib/cache-groups.ts:182-193`).
2. Add a **meal-types group** (also used by F12) and route meal-type CRUD through it:

   ```ts
   /** Meal-type definitions changed — clears the definitions list and the adherence
    *  view that buckets logs by meal type. */
   export async function invalidateMealTypes(): Promise<void> {
     await Promise.all([
       invalidateCache('nutrition-meal-types'),
       invalidateCache('nutrition-adherence'),
     ]);
   }
   ```
   Replace the four `invalidateCache('nutrition-meal-types')` calls in `meal-type-manager.tsx`
   (90, 107, 125, 150) with `invalidateMealTypes()`.

**Verify:** `pnpm dev`; rename/reorder a meal type, open the adherence card — reflects the change
without a 30-min wait. Update `lib/__tests__/cache-groups.test.ts` (`invalidateNutritionWrite` now
includes `nutrition-adherence`).

### CACHE-F6 — native quick-log body-metric write uses the wrong group **(device-verify)**

`app/session-select/session-select-content.tsx` has two body-metric write paths. The **device**
(local-store) path at **line 818** calls only `invalidateReadinessInputs()`; the **web fallback** at
**851-852** calls `invalidateBodyMetricWrite()` **and** `invalidateReadinessInputs()`. The canonical
APK path therefore never clears `body-metadata`/`progress-summary`/`day-log:`, leaving today's steps/
water/weight stale after a quick-log on device.

1. At `session-select-content.tsx:818`, add the missing group call alongside the existing one:

   ```ts
   invalidateBodyMetricWrite().catch(() => {});
   invalidateReadinessInputs().catch(() => {});
   ```
   (`invalidateBodyMetricWrite` is already imported at line 26.)

**Verify:** compile + logic review in-sandbox (both branches now call the same two groups — diff them
side by side per the sync-mirroring discipline). **On-device (S25 APK) is the only real check** — the
web path already worked, so `pnpm dev` cannot exercise the bug; add a Known-Issues row marking F6
NOT-yet-verified-on-device if no device is available this session. CLAUDE.md Canonical Runtime: *green
`pnpm dev` is necessary, never sufficient* for native-path changes.

### CACHE-F8 — pull-to-sync runs a full Oura sync but invalidates a hand-rolled list (med)

`session-select-content.tsx:520-538` `Promise.allSettled`s a `pullDelta` + `POST /api/oura/sync`, then
invalidates `invalidateWorkoutSummaries()` + `invalidateReadinessInputs()` + ad-hoc
`body-metadata`/`sleep-sessions`/`training-load`/`sleep-performance-correlation` (534-537). It **omits
`invalidateOuraSync()`**, which additionally clears `oura-stats`, `oura-hr-day:`, `home-day-timeline`,
`progress-summary`, `weekly-stats`, `oura-token`, `health-trends:`, `health-trends-summary`. Compare
the correct handler in `app/health/health-content.tsx:458, 476` which uses `invalidateOuraSync()`.

1. Add `invalidateOuraSync()` to the `Promise.all([...])` at `session-select-content.tsx:531-538` and
   import it from `@/lib/cache-groups` (line 26). The ad-hoc `body-metadata`/`sleep-sessions`/
   `training-load` entries become redundant (covered by `invalidateOuraSync` +
   `invalidateReadinessInputs`) — collapse to `invalidateWorkoutSummaries()`,
   `invalidateReadinessInputs()`, `invalidateOuraSync()`, keeping `sleep-performance-correlation`
   (not in any group) explicit.

**Verify:** `pnpm dev`; pull-to-sync on session-select, then open Health Oura tiles — HR-day/stats/
sleep reflect the sync without a manual Health refresh.

### CACHE-F10 — `muscle-tonnage-trend` in no group (med)

Fetched at `components/health/weekly-muscle-sets-card.tsx:41, 43` (`TTL_LONG`), invalidated nowhere.

1. Add `invalidateCache('muscle-tonnage-trend')` to `invalidateWorkoutSummaries()`
   (`lib/cache-groups.ts:4-44`). It is also included in F2's `invalidateExerciseLogged` group above.

**Verify:** complete a workout → the weekly muscle-sets card's tonnage trend updates.

### CACHE-F11 — `invalidateActivityWrites()` misses `day-log:` (med)

`app/api/day-log/route.ts:128-130` includes `activityLogs` in its payload, but
`invalidateActivityWrites()` (`lib/cache-groups.ts:141-152`) does not clear `day-log:`, so a saved
walk/run/treadmill doesn't refresh the day-log view.

1. Add `invalidateCache('day-log:')` to `invalidateActivityWrites()`.

**Verify:** log an activity → the day-log (Home day view) shows it without a reload. Update
`lib/__tests__/cache-groups.test.ts` if it asserts that group's contents.

---

## Chunk 4 — Today-guard fetch-hit paths (CACHE-F7, high)

`body-metadata` carries its own freshness date at `today.date`; the shared guard `isBodyMetadataFresh`
(`lib/sqlite/cache.ts:303`) must wrap **both** the synchronous seed read and the `cachedFetch` onData
hit path, or yesterday's steps/water paint each morning until the network lands. Three fetch-hit sites
omit the guard:

1. **`components/overview-screen.tsx:138-141`** —
   ```ts
   await cachedFetch<{ today: BodyMetaRow | null }>(
     'body-metadata', '/api/body-metadata', TTL_MEDIUM,
     (data) => { if (isBodyMetadataFresh(data)) setMetaToday(data.today ?? null); setMetaLoading(false); },
   );
   ```
   Also guard the seed read at `overview-screen.tsx:112` (`readCacheSync('body-metadata')`) the same
   way. Import `isBodyMetadataFresh`.

2. **`components/profile/goals-section.tsx:87-93`** — wrap the `if (d?.today) setTodayMeta(...)` and the
   `weekToDate` set in `if (isBodyMetadataFresh(d)) { … }`. Import `isBodyMetadataFresh`.

3. **`components/nutrition/end-of-day/end-of-day-review.tsx:78-83`** — the onData `d => { meta = d }`
   and the seed `readCacheSync('body-metadata')` at :78 both need guarding: only assign `meta` when
   `isBodyMetadataFresh(d)` (else leave `meta` null so `steps`/`waterMl` fall back to null rather than
   yesterday's). Import `isBodyMetadataFresh`.

**Verify:** `pnpm dev`; seed `body-metadata` with a `today.date` of yesterday (or roll the clock), load
each screen (Overview, Profile goals, End-of-day review) — none paints the stale steps/water; after the
network refetch the correct (today or empty) values show. CLAUDE.md: *a today-guard on the cache seed
isn't enough on its own — the `cachedFetch` onData hit path needs the same guard*.

---

## Chunk 5 — TTL/key duplication (CACHE-F9, F13, med)

### CACHE-F9 — `exercise-history:` fetched at divergent TTLs (= WK-10 part)

- `components/workout/exercise-summary-screen.tsx:47` uses `TTL_SHORT`.
- `components/workout/active-workout-screen.tsx:117` uses `TTL_MEDIUM`.
- Canonical is `EXERCISE_HISTORY_TTL` (= `TTL_MEDIUM`, `lib/cache-ttl.ts:19`).

The same key fetched at two TTLs makes freshness last-writer-wins.

1. Import `EXERCISE_HISTORY_TTL` from `@/lib/cache-ttl` at both sites and use it in place of the raw
   `TTL_SHORT` (exercise-summary line 47, its import at line 12) / `TTL_MEDIUM` (active-workout line
   117, its import at line 15). Drop the now-unused raw import if nothing else in the file uses it.

**Verify:** `pnpm dev`; both the in-workout history view and the post-set summary read the same key at
one TTL. CLAUDE.md: *one canonical TTL per cache key … any key fetched at ≥2 sites gets a named
constant in `lib/cache-ttl.ts`*.

### CACHE-F13 — duplicate keys for `/api/user/profile` (med)

`/api/user/profile` is cached under **two** keys:
- `more-user-profile` (`TTL_MEDIUM`) — `session-select-content.tsx:544`, `more-content.tsx:65/72`,
  `activity/done-activity-screen.tsx:50`, sync-provider warm `sync-provider.tsx:53`.
- `nutrition-user-profile` (`TTL_LONG`) — `nutrition-content.tsx:228`.

Profile edits invalidate only `more-user-profile` (`profile-tab.tsx:257, 697`), so the Nutrition
screen shows a 6-h-stale user after a profile change. (Note `invalidateGoalRecommendations()` clears
*both* keys — `lib/cache-groups.ts:109-110` — but a plain profile-name/avatar edit does not go through
that group.)

1. **Collapse to one key.** Point `nutrition-content.tsx:228` at `more-user-profile` (and `TTL_MEDIUM`),
   deleting the `nutrition-user-profile` key entirely. Update the seed read for nutrition's fitness
   goal if one exists, and remove `nutrition-user-profile` from `invalidateGoalRecommendations()`
   (`lib/cache-groups.ts:109`) — it collapses into `more-user-profile` (already present there via the
   F12 user-profile group, or add `more-user-profile` if not).
2. This is finished by Chunk 7's `invalidateUserProfile()` group (F12), which both profile-save sites
   route through — after F13 there is a single `/api/user/profile` key and a single group that clears it.

**Verify:** `pnpm dev`; edit display name/avatar in Profile, open Nutrition — the header user reflects
the change immediately (previously ≤6 h stale). Grep confirms `nutrition-user-profile` has zero
remaining references.

---

## Chunk 6 — SWR headers + bare-fetch conversions (CACHE-F15, F16, low-med)

### CACHE-F15 — bare `fetch()` GETs of cached endpoints

Client GETs of `/api/*` must go through `cachedFetch` with a `readCacheSync` seed.

1. **`components/day-review-sheet.tsx:42, 48`** — `fetch('/api/workout-sessions/day?date=…')` and
   `fetch('/api/workout-load-history?sessionName=…')`. The `workout-sessions-day:` key already exists
   (invalidated by `invalidateWorkoutSummaries` and F2). Convert the day fetch to
   `cachedFetch('workout-sessions-day:'+date, …, TTL_SHORT, …)` with a `readCacheSync` seed; add a
   `workout-load-history:<sessionName>` key + seed for the second (register it in
   `invalidateWorkoutSummaries()`). The `POST /api/daily-digest` at line 35 stays a bare `fetch` (it's
   a mutation, not a GET).
2. **`app/health/timeline/page.tsx:73`** — `fetch('/api/day-timeline?date=…')`. Convert to
   `cachedFetchToday('day-timeline:'+today, …)` (or reuse the existing `home-day-timeline`/`day-timeline`
   key if one already seeds this — grep first; `home-day-timeline.tsx:9` uses `cachedFetchToday`). Seed
   with `readTodayCacheSync`. Reuse the existing key rather than minting a duplicate for the same
   endpoint.

**Verify:** `pnpm dev`; open the day-review sheet and the health timeline twice — second open paints
from cache with no skeleton. CLAUDE.md: *client GETs of `/api/*` use `cachedFetch` with a `readCacheSync`
seed, never bare `fetch`; before adding a cache key, grep for an existing key for the same endpoint and
reuse it*.

### CACHE-F16 — aggregate GET routes with no SWR headers

Add `Cache-Control: private, max-age=60, stale-while-revalidate=120` (the sibling-route string, e.g.
`app/api/weekly-stats/route.ts`, `app/api/progress-summary/route.ts`) at response creation. Routes
**confirmed missing** the header (absent from the 41 files that already set `Cache-Control`):

- `app/api/day-log/route.ts`
- `app/api/oura/stats/route.ts`
- `app/api/friends/feed/route.ts`
- `app/api/friends/leaderboard/route.ts`
- `app/api/ai-periodization/weekly-volume/route.ts`
- `app/api/ai-periodization/program-overview/route.ts`
- `app/api/activity-logs/route.ts`
- `app/api/workout-load-history/route.ts`

Plus **`app/api/year-review/route.ts`** — it *has* a `Cache-Control` header but lacks the
`stale-while-revalidate` window; extend it to the standard string.

1. For each route, add the header to the `NextResponse.json(..., { headers: { 'Cache-Control': … } })`
   (match the exact sibling string; verify each route's current header before editing — a couple may
   already have been retrofitted since the review).

**Verify:** `curl -sI localhost:3000/api/<route>` for each shows the SWR header. CLAUDE.md: *new
aggregate GET routes ship SWR headers at creation*.

---

## Chunk 7 — Ad-hoc invalidation → named groups (CACHE-F12) + hygiene (F14, F17)

### CACHE-F12 — promote remaining single-key invalidations to named groups

Every write-site single-key `invalidateCache(...)` becomes a named group helper in
`lib/cache-groups.ts` (CLAUDE.md: *every mutation invalidates via a named group helper*). Confirmed
current sites:

| Site | Current call | New group |
|---|---|---|
| `components/more/profile-tab.tsx:257, 697` | `invalidateCache('more-user-profile')` | `invalidateUserProfile()` (also closes F13) |
| `components/more/oura-section.tsx:139` | `invalidateCache('oura-token')` | `invalidateOuraToken()` |
| `components/health/ai-periodization-status-card.tsx:72` | `invalidateCache('ai-periodization-overview')` | `invalidateAiPeriodization()` |
| `components/nutrition/meal-type-manager.tsx:90,107,125,150` | `invalidateCache('nutrition-meal-types')` | `invalidateMealTypes()` (already added in F5) |
| `components/exercises/add-exercise-sheet.tsx:143, 170` | `invalidateCache('exercise-library')` | `invalidateExerciseLibrary()` |
| `components/admin/exercise-manager.tsx:272, 287` | `invalidateCache('exercise-library')` | `invalidateExerciseLibrary()` |
| `components/admin/activity-type-manager.tsx:135, 153` | `invalidateCache('activity-types')` | `invalidateActivityTypes()` |

Add the helpers (single-key bodies are fine — the point is a *named*, greppable group per domain):

```ts
export async function invalidateUserProfile(): Promise<void> {
  await invalidateCache('more-user-profile');   // the sole /api/user/profile key after F13
}
export async function invalidateOuraToken(): Promise<void> {
  await invalidateCache('oura-token');
}
export async function invalidateAiPeriodization(): Promise<void> {
  await Promise.all([
    invalidateCache('ai-periodization-overview'),
    invalidateCache('weekly-volume-target'),      // sibling AI-periodization view
  ]);
}
export async function invalidateExerciseLibrary(): Promise<void> {
  await invalidateCache('exercise-library');
}
export async function invalidateActivityTypes(): Promise<void> {
  await invalidateCache('activity-types');
}
```

- `app/more/more-content.tsx:93` `invalidateCache('')` is a deliberate clear-all (sign-out) — leave it.
- `workout-screen.tsx` single-key sites (280 `workout-data:<tab>`, 994 `workout-data` paired with
  `invalidateWorkoutSummaries`) are structural/paired and are addressed by F2/F3 — no separate group
  needed; the stale F12 reference to `workout-screen.tsx:~969` is a POST (`log-calendar-event`), not an
  invalidation, so nothing to promote there.

**Verify:** `pnpm dev`; exercise each write (edit profile, disconnect/reconnect Oura token, regenerate
AI periodization, add exercise, admin edit activity type) and confirm the corresponding view refreshes.

### CACHE-F14 — delete dead legacy sessionStorage plumbing (low)

`ta_streak_v1` and `ta_calendar_v2_*` are **read + cleared but never written** (grep: no `setItem` for
either; `ta_recommendation_v1`/`ta_meta_v1` **are** written at `session-select-content.tsx:404, 432` —
keep those). Dead reads always return null.

1. `app/session-select/session-select-content.tsx:265-277` — remove the `calKey`/`calRaw`
   (`ta_calendar_v2_*`) and `streakRaw` (`ta_streak_v1`) reads and their two `if (…) { … }` merge
   blocks, **keeping** `const now = new Date()` and `const merged = {}` (used by the TTL-backed reads at
   278-289 that replace them).
2. `lib/utils.ts:26-30` — delete the `invalidateCalendarCache()` helper (clears the dead
   `ta_calendar_v2_*` key), and its call at `components/workout-screen.tsx:852`. Update the
   `docs/module-map.md:84` mention.
3. `lib/cache-groups.ts:55-58` — remove the `ta_streak_v1` `removeItem` and the `ta_calendar_v2_*`
   filter/forEach from `invalidateWorkoutSummaries`'s sessionStorage block; **keep** the
   `ta_recommendation_v1`/`ta_meta_v1` `removeItem` lines (53-54, still live).

**Verify:** `pnpm dev`; session-select calendar dots + recommendation still seed instantly (from the
TTL-backed `calendar-data:`/`streak-data`/`next-session` keys); grep confirms zero remaining
`ta_streak_v1` / `ta_calendar_v2_` references.

### CACHE-F17 — TTL-constant + misc hygiene (low-med)

1. **`nutrition-food-logs-<date>` raw `60` TTL at 3 sites** — `app/nutrition/nutrition-content.tsx:132`,
   `components/nutrition/assign-step.tsx:40`, `components/sync-provider.tsx:220`. Add
   `export const NUTRITION_FOOD_LOGS_TTL = 60;` (with the same "changes during logging" rationale
   comment) to `lib/cache-ttl.ts` and import it at all three sites.
2. **Raw literals equal to named constants:**
   - `components/workout-screen.tsx:205` `const TTL = 6 * 60 * 60` → `TTL_LONG`.
   - `components/more/profile-tab.tsx:194` `5 * 60` → `TTL_SHORT`.
   - `components/home-day-timeline.tsx:12` `const TTL = 5 * 60 * 1000` — **verify the units first**:
     `cachedFetchToday` takes *seconds*, so `5*60*1000` would be 3.5 days if passed as a TTL. Either it's
     a refresh-interval (ms) used elsewhere — leave with a clarifying name — or a units bug to fix to
     `TTL_SHORT`. Confirm the usage at implementation time before touching.
3. **Group gaps** (register each bare key in the group of its writer, per the review's F17 note):
   `body-battery`, `mood:<date>`, `year-review`, `admin-pending-count`, `exercise-library` (the last is
   covered by F12's `invalidateExerciseLibrary`). For each, find the writer and add the key to that
   write's group — e.g. `mood:<date>` → `invalidateReadinessInputs()`; `body-battery` →
   `invalidateBiometrics()`/`invalidateOuraSync()`. Verify each has a real writer before adding (some
   may be read-only-derived and legitimately TTL-only).
4. **`components/nutrition/tdee-adaptation-card.tsx:24-30`** — the `useState(() => localStorage.getItem(…))`
   lazy initializer reads storage during render (hydration-mismatch risk; CLAUDE.md: *seed in a
   `useEffect`, never in a `useState` lazy initializer*). Convert to `useState(false)` + a mount
   `useEffect` that reads `localStorage.getItem(nudgeStorageKey())` and `setDismissed`.
5. **Done-screen HR sync doesn't clear today's `oura-hr-day:`** — `components/workout/done-screen.tsx:136`
   fires `POST /api/oura/hr-sync` then reads `/api/oura/hr-data` (line 142) but never invalidates the
   `oura-hr-day:<date>` cache, so the Home/Health HR-day chart shows pre-workout HR. After the sync
   POST resolves, add `invalidateCache('oura-hr-day:')` (or call `invalidateOuraSync()` if the broader
   clear is acceptable there).

**Verify:** `pnpm dev`; typecheck + lint clean; the food-logs/workout-data/profile TTLs resolve to the
named constants (no behaviour change, grep shows the constants); tdee card dismissal survives reload
without a hydration warning; after a done-screen HR sync the HR-day chart reflects the workout window.

---

## Test & rollout

- **Unit:** extend `lib/__tests__/cache-groups.test.ts` for the new/changed groups
  (`invalidateExerciseLogged`, `invalidateMealTypes`, `invalidateNutritionWrite`+adherence,
  `invalidateActivityWrites`+`day-log:`, `invalidateWorkoutSummaries`+`muscle-tonnage-trend`, and the
  F12 helpers). Add a boundary test for `isWorkoutDataToday` (23:59→00:01).
- **Local dev:** run the full `pnpm dev` flow across the touched screens (Nutrition, Health, session-select,
  Overview, Profile goals, End-of-day review, day-review sheet, health timeline, Config phase sets).
- **SWR headers:** `curl -sI` each F16 route.
- **Device (F6 only):** the native quick-log body-metric invalidation is APK-only — either verify on the
  S25 per `docs/device-smoke-checklist.md` or land a `projectOverview.md` Known-Issues row marking F6
  NOT-verified-on-device. Everything else is fully covered by `pnpm dev`.
- Bump `package.json` patch + add a `lib/changelog.ts` entry (bug-fix batch) in the same PR; fold the
  journal/`projectOverview.md` update in last, before merge confirmation.

**Shipped (session 248).** All 17 findings implemented as specced, with two deliberate
deviations: F4's per-consumer guards were collapsed into a single sanitize-at-source point in
`workout-screen.tsx` (`freshExercises()`, applied at all three `setExercises` call sites reading
cache-derived data) rather than threading a `freshToday` guard through `pre-workout-screen.tsx`/
`done-screen.tsx`/`handleContinueWorkout` separately — those all read the same `exercises` state,
so one guard covers all of them with less surface touched in the highest-regression-risk file.
F16 also picked up two early-return success paths the plan didn't call out by name
(`oura/stats`'s `connected: false` branch, `friends/feed`'s empty-friends branch,
`ai-periodization/program-overview`'s no-active-program branch) — these are the *common* case for
many users, so leaving them unheadered would have defeated most of the SWR benefit. Verified
end-to-end on the local dev DB + `pnpm dev`: all touched screens render 200, `curl -sI` confirms
the SWR header on all 9 GET routes (8 listed + year-review), unit tests extended and green
(1052 total). Device-only: F6's native quick-log path is compile/logic-verified only (both
branches now call the identical two groups, diffed side by side) — not exercised on-device this
session.
