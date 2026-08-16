# Home Page Freshness, Caching & Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the home page (`/` → `app/session-select/session-select-content.tsx`) actually fresh and fast: stop firing the dead Oura *Cloud* sync from home surfaces (and make the header Refresh drain the ring instead), fix the cache-correctness bugs that make home paint stale after config edits and workout completion, seed the remaining server-only widgets from the local store so home paints offline, cut redundant requests/re-renders, and clear the home-specific theme/a11y/touch-target violations not already owned by queued plans.

**Architecture:** Five independent chunks, ordered by user-visible value. Chunk 1 retires the frozen-Cloud `/api/oura/sync` calls on home surfaces and wires the BLE drain (`lib/oura-ble/sync.ts`) into the header Refresh + client cache invalidation after a drain. Chunk 2 fixes invalidation gaps (legacy sessionStorage seeds, the dead optimistic streak stamp) and drops home's redundant `calendar-data` fetch. Chunk 3 adds local-first read seeds (sleep, trained-days/streak, week-to-date) from tables `pullDelta` already populates. Chunk 4 is render hygiene (memo the un-memoized cards, extract two sheets out of the 1,516-line orchestrator). Chunk 5 is token/a11y/touch-target fixes scoped to home files.

**Tech Stack:** Next.js 15 / React 19 client components, `lib/sqlite/cache.ts` (`cachedFetch`/`readCacheSync`/`setCached`), `lib/cache-groups.ts`, `lib/local-store/` (Capacitor SQLite), `lib/oura-ble/` (native BLE plugin bridge), Vitest.

---

## Background — why (owner request, 2026-07-10)

The owner asked for a full review of the home page/dashboard — widgets, data, caching, cache
busting, slow loads, local-first reads, performance, UI, HR. A four-angle audit (caching/data
flow, render/bundle, offline/local-first + sync, UI/theme/dates) of
`app/session-select/session-select-content.tsx` and every component it renders produced the
findings below. Every finding was verified at `main`@`3f7dd47` with file:line evidence; several
overlap plans already in the queue (referenced by batch name, not queue position — positions churn) — the table in the next section fixes ownership so nothing is
double-implemented.

### Headline verified findings owned by THIS plan

| id | sev | where | what |
|---|---|---|---|
| HOME-1 | high | `session-select-content.tsx:534-540` | `handlePullSync` POSTs `/api/oura/sync` — the Oura **Cloud is frozen** since the 2026-07-07 re-key, so this is ~15 wasted external round-trips per pull that can never return new data. The BLE drain is already fired separately by `PullToSync` (`pull-to-sync.tsx:59`). The `toast.error('Oura sync failed')` only fires on transport rejection, never on the (always-200) frozen response — dead code giving false reassurance. |
| HOME-2 | high | `session-select-content.tsx:998-1002` | The header **Refresh button** fires *only* the dead Cloud sync and never drains the ring (`syncOuraRing()` is absent) — pressing Refresh cannot surface new Oura data at all. |
| HOME-3 | med | `components/activity/exercise-detected-card.tsx:61-73` | Third rogue Cloud-sync site on home mount (5-min self-throttle) + a bare `fetch` GET. Supersedes R6 PERF-3 — see ownership table. |
| HOME-4 | med | `components/oura-ble/oura-ble-debug.tsx`, `lib/oura-ble/sync.ts` | Nothing invalidates client caches after a BLE drain/redecode — home's HR chart (`oura-hr-day:*`), sleep and body-metrics stay stale until TTL expiry even though new ring data just landed server-side. |
| HOME-5 | high | `lib/cache-groups.ts:95-108` | `invalidateProgramStructure()` (fired by every Config save) does **not** clear the legacy sessionStorage seeds `ta_meta_v1`/`ta_recommendation_v1` — home first-paints the pre-edit session list/recommendation after renaming/deleting a session. Only `invalidateWorkoutSummaries()` clears them (`:54-59`). |
| HOME-6 | high | `components/workout-screen.tsx:1013-1035` | The optimistic "trained today" stamp is a **dead no-op**: `invalidateWorkoutSummaries()` synchronously clears the sync mirrors *before* `updateCache(...)` runs, and `updateCache` no-ops on a cleared cache (`lib/sqlite/cache.ts:126-127`). Home doesn't show the just-completed session on streak/week-strip until the network refetch — the "completing a workout looks slow" class again. |
| HOME-7 | med | `session-select-content.tsx:427-438` | Home fetches **both** `calendar-data:<month>` and `streak-data` and merges only `.trainedDays` from each — `streak-data` (90 days) is a strict superset of what home needs; `activityDays` is never read here. One redundant request per load, plus the double `setCalendarDays` makes the `streak` memo (a ≤365-iteration `formatInTimeZone` walk, `:931-950`) and `weekStrip` memo recompute twice. |
| HOME-8 | med | `session-select-content.tsx:523/:569`, `home-card-widget.tsx` sleep widget | Sleep is read server-only (`/api/sleep-sessions`) although `sleep_sessions` is pulled into the local store (`sync-engine.ts:112-120`) and `store.getSleepSessions` exists — offline-first read-side violation. |
| HOME-9 | med | `session-select-content.tsx:427-438` | Trained-days/streak/week-strip read server-only although `workout_sessions` is in the local store (`sync-engine.ts:122-131`) — a fresh install after one sync paints no streak offline. |
| HOME-10 | low | `session-select-content.tsx:361-386` | `fetchMeta`'s local fast-path never computes `weekToDate` (steps/calories/water weekly tiles are null offline) even though the rows are already loaded. |
| HOME-11 | med | non-memoized cards | `OuraScoreChipRow`, `DeloadBanner`, `RestDayCard`, `EarlyDeloadCard`, `GoalsCheckinCard` are un-memoized under an orchestrator that re-renders on ~13 independent fetch resolutions. (The big cards are already memo'd with clean call sites — verified.) |
| HOME-12 | med | `session-select-content.tsx` (1,516 lines) | >800-line rule violation; quick-log sheet + week-day overlay sheet are self-contained extractions (R6 PERF-12 named them "easiest lifts" but did not own them — owned here). |
| HOME-13 | med | assorted home files | Token/palette violations not owned by R7: `text-white` on the user-pickable accent Start button (`recommendation-card.tsx:289`), admin badge `bg-red-500 text-white` (`session-select-content.tsx:1027`), `bg-brand text-white` Save (`:1489`), `goals-checkin-card.tsx:20`, `early-deload-card.tsx:23` (`bg-amber-600 text-white`), white-alpha literals (`home-card-widget.tsx:137,304`), week-strip `text-white` (`week-strip-card.tsx:54,60`), muscle-status inline thresholds+hex (`home-card-widget.tsx:305`). |
| HOME-14 | med | `readiness-card.tsx:122-126`, `body-battery-card.tsx:88-91`, header buttons | Expand toggles are bare `<div onClick>` (no role/aria-expanded/keyboard); header icon buttons ≈32px and dismiss buttons ≈26-28px are under the 44px touch floor (`session-select-content.tsx:985-1009`, `:1085`; `metric-tiles-card.tsx:95`). |
| HOME-15 | low | `app/api/mood/route.ts:29`, `app/api/admin/pending-count/route.ts:16` | The only two home GET routes without SWR `Cache-Control` headers. (`/api/body-metadata`'s `private, no-store` at `route.ts:151` is deliberate — it folds live today-data; gains a comment, not a change.) |
| HOME-16 | low | `mood-checkin-sheet.tsx:159,170` | `mood:<date>` TTL written as literal `5 * 60` instead of `TTL_SHORT` — violates the one-canonical-TTL rule. |
| HOME-17 | doc | `CLAUDE.md` cache section | Still lists `ta_streak_v1`/`ta_calendar_v2_*` as live stale-seed hazards; verified fully dead in source (docs-only mentions). |

### Ownership vs. already-queued plans — do NOT double-implement

| Finding from this review | Owner | Note |
|---|---|---|
| chart.js in home bundle via `day-review-sheet.tsx:9` | **R6 batch** (PERF-1) | already planned |
| `BodyBatteryCard` dynamic-import `loading:` skeleton over a cache-seeded card | **R6** (PERF-2 area) | already planned |
| `meteors.tsx:38` 3-second `setInterval` DOM churn | **R6** | already planned |
| Exercise-detected-card rogue sync + bare fetch (R6 PERF-3) | **THIS plan, Task 1.3** | supersedes R6 PERF-3 entirely (removes the Cloud call rather than re-throttling it) — R6 plan annotated |
| `workout-card:<id>` N+1 prefetch fan-out | **R6** (Chunk 4, `?tab=all` batch) | already planned |
| Day-review + weekly-recap nested `<span role="button">` banners, `DismissibleBanner` primitive, aria-expanded sweep, emoji→Lucide (incl. `ENERGY_EMOJI`, `#fbbf24` mood card), `resolveColor` hoist | **R7 batch** | already planned; Task 5 here only covers home items R7 does **not** list |
| `deviceTz`-keyed `aestDateString`/`weekStrip`/sleep-widget `_today/_yesterday` vs the server's `Australia/Brisbane` bucketing; `Date.now() − N×86_400_000` day walking | **R8 batch** (DATE-A7) | already planned — also makes the streak walk cheap (`shiftDateStr`, no per-day `Intl`) |
| Sleep-stage palette dedup (home sleep widget vs Hypnogram `STAGE_COLOR`) | **R8** (formula/palette dedup) | already planned |
| `home-day-timeline` server-only today aggregate; `early-deload-card` missing failure state | **R3 batch, remaining chunks** (SYNC-R3) | already planned |
| SyncProvider mount/resume Cloud sync + `OURA_LAST_SYNC_KEY` "last synced" semantics; retiring `/api/oura/sync` app-wide | **Oura BLE data-mapping backlog item, Chunk 4** (Cloud-sync cutover) | this plan removes only the *home-surface* call sites; the app-wide cutover policy stays with that item |
| Legacy-seed clearing at health-content `handleEditSave` + `ta_recommendation_v1` date-stamping (midnight-rollover staleness, CCH-4) | **Workout-system hardening batch** (session 261, `2026-07-10-workout-system-hardening.md`) | coordinate: once this plan's `clearLegacyHomeSeeds()` (Task 2.1) exists, that plan's health-content task should call it; its date-stamped `{ date, data }` envelope for `ta_recommendation_v1` composes with (does not replace) the clearing added here. The stamp's device-tz *keying* stays with R4/R8 — this plan's Task 2.2 fixes only the ordering no-op. |

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `app/session-select/session-select-content.tsx` | Modify | Tasks 1.1, 1.2, 2.4, 3.1–3.3, 4.1–4.2, 5.2–5.3 |
| `components/activity/exercise-detected-card.tsx` | Modify | Task 1.3 |
| `lib/oura-ble/sync.ts` | Modify | Task 1.4 (post-drain invalidation + event) |
| `components/oura-ble/oura-ble-debug.tsx` | Modify | Task 1.4 (invalidate after redecode/manual drain) |
| `lib/cache-groups.ts` | Modify | Task 2.1 (`clearLegacyHomeSeeds`), Task 1.3 (`oura-unreviewed-workouts` registration) |
| `components/workout-screen.tsx` | Modify | Task 2.2 (stamp-before-invalidate ordering) |
| `app/api/mood/route.ts`, `app/api/admin/pending-count/route.ts` | Modify | Task 2.3 (SWR headers) |
| `app/api/body-metadata/route.ts` | Modify | Task 2.3 (comment only) |
| `components/mood-checkin-sheet.tsx` | Modify | Task 2.3 (TTL constant) |
| `CLAUDE.md` | Modify | Task 2.5 (stale seed-hazard list) |
| `app/session-select/components/log-value-sheet.tsx` | Create | Task 4.2 |
| `app/session-select/components/week-day-sheet.tsx` | Create | Task 4.2 |
| `components/oura-score-chip-row.tsx`, `app/session-select/components/{deload-banner,rest-day-card via components/}.tsx`, `components/home/{early-deload-card,goals-checkin-card}.tsx`, `components/rest-day-card.tsx` | Modify | Task 4.1 (memo) |
| `lib/health/recovery-band.ts` | Create | Task 5.4 (muscle-status thresholds/colors, one place) |
| `components/home/home-card-widget.tsx` | Modify | Tasks 5.3–5.4 |
| `app/session-select/components/{recommendation-card,week-strip-card,metric-tiles-card}.tsx` | Modify | Tasks 5.2, 5.5 |
| `components/{readiness-card,body-battery-card}.tsx` | Modify | Task 5.5 (a11y toggles) |
| `lib/__tests__/cache-groups-legacy-seeds.test.ts` | Create | Task 2.1 test |
| `lib/changelog.ts`, `package.json` | Modify | version bump (patch) + entry, final commit |

No DB migration. No Kotlin — everything ships via Railway. **Not exercisable in-sandbox:** the
actual BLE drain (Task 1 paths are no-ops off-device — verify wiring by code-read + the
`pnpm dev` Network panel showing the Cloud call gone), Samsung WebView paint, and touch-target
feel; run `docs/device-smoke-checklist.md` on the S25 for Tasks 1, 4 and 5 after merge.

---

### Task 1: Retire dead Cloud syncs on home; Refresh drains the ring; BLE sync busts client caches

**Files:**
- Modify: `app/session-select/session-select-content.tsx:530-550` (handlePullSync), `:992-1009` (Refresh button)
- Modify: `components/activity/exercise-detected-card.tsx:50-73`
- Modify: `lib/oura-ble/sync.ts`
- Modify: `components/oura-ble/oura-ble-debug.tsx` (redecode + manual drain handlers)
- Modify: `lib/cache-groups.ts` (register `oura-unreviewed-workouts` in `invalidateOuraSync`)

- [ ] **Step 1.1: handlePullSync — drop the Cloud POST and its dead toast**

```ts
const handlePullSync = useCallback(async () => {
  // The ring itself is drained by PullToSync (syncOuraRing()) in parallel with this
  // callback — the Oura Cloud has been frozen since the 2026-07-07 re-key, so the old
  // POST /api/oura/sync here was pure waste (CLAUDE.md, Oura Direct-BLE section).
  if (userId) await pushMutations(userId).catch(() => {});
  if (userId) await pullDelta(userId, true).catch(() => {});
  await Promise.all([
    invalidateWorkoutSummaries(),
    invalidateReadinessInputs(),
    invalidateOuraSync(),
    invalidateCache('sleep-performance-correlation'),
  ]).catch(() => {});
  refetchAll().catch(() => {});
}, [userId, refetchAll]);
```

- [ ] **Step 1.2: Header Refresh — drain the ring instead of the Cloud**

Add `import { syncOuraRing } from '@/lib/oura-ble/sync'` and replace the button's Cloud fetch:

```ts
onClick={() => {
  invalidateCache('workout-data:meta');
  fetchWorkoutData();
  fetchMeta();
  void syncOuraRing();                              // BLE drain — replaces the dead Cloud sync
  if (userId) pullDelta(userId, true).catch(() => {});
}}
```

- [ ] **Step 1.3: exercise-detected-card — delete the rogue Cloud sync, cache the GET** *(supersedes R6 PERF-3)*

Remove the whole `THROTTLE_KEY`/`ta_oura_workout_sync_ms` block (`:61-73`). Convert the bare GET:

```ts
function fetchWorkouts() {
  return cachedFetch<OuraWorkout[]>(
    'oura-unreviewed-workouts', '/api/oura/workouts?unreviewed=true', TTL_MEDIUM,
    ingestWorkouts,
  ).catch(() => {})
}
```

Register the new key in `invalidateOuraSync()` in `lib/cache-groups.ts`, and invalidate it in
`ExerciseReviewSheet`'s save/dismiss completion path (grep its POST handlers — the reviewed
session must disappear without a TTL wait; the cache-groups rule requires every writer
registered in the same commit).

- [ ] **Step 1.4: BLE drain/redecode → client cache invalidation**

In `lib/oura-ble/sync.ts`, after the drain is kicked, poll the plugin status until the drain
completes (verify the exact status field against `lib/oura-ble/plugin.ts` — the service exposes
drain/cursor state; fall back to a bounded timeout), then invalidate + notify:

```ts
import { invalidateOuraSync } from '@/lib/cache-groups'

async function afterDrainSettles(ble: NonNullable<Awaited<ReturnType<typeof getOuraBle>>>) {
  // Native ingest lands asynchronously after drainHistory() resolves — poll status
  // (bounded) so we invalidate after data is actually in Postgres, not before.
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 3_000))
    try {
      const s = await ble.plugin.getStatus()
      if (s.state !== 'draining') break   // ← verify field/value against plugin.ts
    } catch { break }
  }
  await invalidateOuraSync().catch(() => {})
  window.dispatchEvent(new Event('ta:oura-ble-synced'))
}
```

Call `void afterDrainSettles(ble)` from `syncOuraRing()` after the drain/start call. In
`session-select-content.tsx`, listen for the event and bump `refreshTick` so the gated effects
(readiness, body-battery, hr-day, training-load) refetch:

```ts
useEffect(() => {
  const onBleSynced = () => setRefreshTick(t => t + 1)
  window.addEventListener('ta:oura-ble-synced', onBleSynced)
  return () => window.removeEventListener('ta:oura-ble-synced', onBleSynced)
}, [])
```

In `components/oura-ble/oura-ble-debug.tsx`, `await invalidateOuraSync()` after a successful
redecode response and after the one-tap Sync & Redecode completes.

- [ ] **Step 1.5: Verify**

`pnpm dev`, Network panel on `/`: mount, pull-to-refresh, and header Refresh fire **zero**
`POST /api/oura/sync`; `oura/workouts` GET is served from cache on a second mount. `pnpm lint
&& pnpm exec tsc --noEmit && pnpm test`. BLE paths are inert on web — code-read the wiring;
on-device drain → home HR chart repaint is the owner's post-merge check.

- [ ] **Step 1.6: Commit** — `perf(home): stop firing the frozen Oura Cloud sync from home; Refresh drains the ring`

---

### Task 2: Cache correctness

**Files:**
- Modify: `lib/cache-groups.ts`, `components/workout-screen.tsx:1009-1040`
- Modify: `app/api/mood/route.ts`, `app/api/admin/pending-count/route.ts`, `app/api/body-metadata/route.ts`
- Modify: `components/mood-checkin-sheet.tsx:159,170`, `app/session-select/session-select-content.tsx`
- Modify: `CLAUDE.md`
- Create: `lib/__tests__/cache-groups-legacy-seeds.test.ts`

- [ ] **Step 2.1: `clearLegacyHomeSeeds()` — legacy seeds die on program edits too** *(HOME-5)*

In `lib/cache-groups.ts`, extract the existing sessionStorage removal from
`invalidateWorkoutSummaries` into a named helper and call it from **both** groups:

```ts
/** Legacy sessionStorage seeds read by session-select-content's first-paint effect.
 *  They live outside the TTL cache, so every group that invalidates workout-data:meta
 *  or next-session MUST also clear these — a stale seed wins the first-paint race. */
function clearLegacyHomeSeeds(): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem('ta_recommendation_v1')
    sessionStorage.removeItem('ta_meta_v1')
  } catch { /* sessionStorage unavailable */ }
}
```

Call it at the end of `invalidateWorkoutSummaries()` (replacing the inline block) **and**
`invalidateProgramStructure()`. Unit test (jsdom): seed both keys, run
`invalidateProgramStructure()`, assert both removed.

> Coordination: the workout-system hardening plan (session 261) adds the same two removals inline
> at health-content `handleEditSave` — if this helper lands first, that task should import it; if
> that plan lands first, fold its inline copy into this helper here.

- [ ] **Step 2.2: Fix the dead optimistic "trained today" stamp** *(HOME-6)*

In `components/workout-screen.tsx` `completeWorkout`, read the cached payloads **before**
invalidation clears the sync mirrors, await the invalidation, then write the stamped values
back with `setCached` (not `updateCache`, which no-ops on a cleared cache):

```ts
const cachedCal = readCacheSync<{ trainedDays: Record<string, string[]>; activityDays: Record<string, string[]> }>(calendarKey);
const cachedStreak = readCacheSync<{ trainedDays: Record<string, string[]> }>('streak-data');
invalidateCache('workout-data').catch(() => {});
void (async () => {
  // Await so the async invalidation can't race the optimistic re-seed below.
  await invalidateWorkoutSummaries().catch(() => {});
  if (cachedCal) await setCached(calendarKey, { ...cachedCal, trainedDays: stampTrainedDay(cachedCal.trainedDays ?? {}) }, TTL_MEDIUM).catch(() => {});
  if (cachedStreak) await setCached('streak-data', { ...cachedStreak, trainedDays: stampTrainedDay(cachedStreak.trainedDays ?? {}) }, TTL_LONG).catch(() => {});
})();
```

Verify by code-read that `setCached` writes the sync mirrors (so home's next
`readCacheSync('streak-data')` seed sees the stamp), and in `pnpm dev`: complete a workout →
navigate home → the week strip shows today trained **immediately**, before any network response
(throttle the network in DevTools to prove it).

- [ ] **Step 2.3: Route/TTL hygiene** *(HOME-15/16)*

`app/api/mood/route.ts` GET + `app/api/admin/pending-count/route.ts` GET: add the sibling SWR
header `response.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120')`.
`app/api/body-metadata/route.ts:151`: add a one-line comment that `no-store` is deliberate
(folds live today food/activity — do not "fix" to SWR). `components/mood-checkin-sheet.tsx`:
replace both `5 * 60` literals with `TTL_SHORT` imported from `@/lib/cache-ttl`.

- [ ] **Step 2.4: Drop home's redundant `calendar-data` fetch** *(HOME-7)*

In `fetchWorkoutData`, delete the `calendar-data:<month>` `cachedFetch` (home reads only
`trainedDays`, and `streak-data` already returns 90 days of it — a strict superset of the week
strip + streak window that has data today). Keep the two `readCacheSync('calendar-data:…')`
seeds in the mount effect (they still help when the calendar screen has warmed those keys) and
keep the `calendar-data` stamp in Task 2.2 (the calendar screen still consumes that key). Net:
one fewer request per home load **and** a single `setCalendarDays` write, so the `streak`/
`weekStrip` memos compute once. Verify in `pnpm dev` (Network panel + week strip unchanged,
including a trained day in the previous month within the last 90 days).

- [ ] **Step 2.5: CLAUDE.md stale-hazard correction** *(HOME-17)*

In the cache-invalidation section, the legacy-seed hazard list — drop `ta_streak_v1` /
`ta_calendar_v2_*` (verified dead in source; only docs mention them) and note the two live ones
are now cleared via `clearLegacyHomeSeeds()` in both groups.

- [ ] **Step 2.6: Run gate + commit** — `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`; commit `fix(cache): home staleness — legacy seeds on program edits, dead post-workout stamp, redundant calendar fetch`

---

### Task 3: Local-first home reads (offline paint)

**Files:**
- Modify: `app/session-select/session-select-content.tsx` (`fetchMeta`, mount effect, `fetchWorkoutData`)

All three seeds follow the supplements/`fetchMeta` reference pattern: local store first (instant,
works offline), network hydrate second. `pullDelta` already populates every table involved
(`sync-engine.ts:76-168`) — this is purely the read side.

- [ ] **Step 3.1: Sleep widget seeds from the local store** *(HOME-8)*

In the sleep effect (before `fetchWithRetry('sleep-sessions', …)`):

```ts
const store = userId ? getLocalStore(userId) : null;
if (store) {
  try {
    const cutoff = toAestDay(new Date(todayMidnightUtc().getTime() - 14 * 24 * 60 * 60 * 1000));
    const local = await store.getSleepSessions(cutoff);
    if (local.length > 0 && !cancelled) {
      setSleepData(local.map(s => ({
        date: s.date,
        durationHours: s.durationHours,
        deepSleepHours: s.deepSleepHours,
        remSleepHours: s.remSleepHours,
        lightSleepHours: s.lightSleepHours,
        awakHours: null,               // LocalSleepSession has no awake column — render handles null
      })));
    }
  } catch { /* store unavailable — network path below still runs */ }
}
```

The network fetch stays as the hydrate/fallback (do NOT remove it — cross-device data arrives
via `pullDelta`, and the web sandbox has no local store).

- [ ] **Step 3.2: Trained-days seed from local workout history** *(HOME-9)*

In the mount effect's calendar-seed block, before the TTL-cache reads:

```ts
if (userId) {
  const store = getLocalStore(userId);
  if (store) {
    try {
      const cutoff = toAestDay(new Date(todayMidnightUtc().getTime() - 90 * 24 * 60 * 60 * 1000));
      const sessions = await store.getWorkoutSessions(cutoff);
      const local: Record<string, string[]> = {};
      for (const s of sessions) {
        if (s.deletedAt || !s.completedAt) continue;   // verify: match getCalendarData's completed-only semantics
        const key = formatInTimeZone(new Date(s.startedAt), DEFAULT_TZ, 'yyyy/MM/dd');
        (local[key] ??= []).push(s.sessionName);
      }
      if (Object.keys(local).length) setCalendarDays(prev => ({ ...local, ...prev }));
    } catch { /* ignore */ }
  }
}
```

**Verify first** (code-read `getCalendarData` in `lib/data/postgres/adapter.ts:935-1005`):
whether the server counts non-completed sessions, and that its `to_char(... 'YYYY/MM/DD')`
key format matches. Key by `DEFAULT_TZ`, not device tz — the server buckets in
`Australia/Brisbane` (`adapter.ts:941`); R8's DATE-A7 makes the rest of the file consistent
with this. This requires converting the mount `useLayoutEffect` body's calendar block to an
async inner function — keep the synchronous cache-seed reads running before the first `await`
so first paint is unchanged.

- [ ] **Step 3.3: `weekToDate` computed locally in `fetchMeta`'s fast-path** *(HOME-10)*

Inside the existing `rows.length > 0` block, after `setMetaRecent(...)`:

```ts
const weekStart = startOfWeekInTz();   // 'yyyy-MM-dd', Monday, DEFAULT_TZ — matches the server rollup
const wk = rows.filter(m => m.date >= weekStart);
setWeekToDate({
  steps:    wk.reduce((s, m) => s + (m.steps ?? 0), 0),
  calories: wk.reduce((s, m) => s + (m.calories ?? 0), 0),
  waterMl:  wk.reduce((s, m) => s + (m.waterMl ?? 0), 0),
});
```

**Verify first:** code-read the server's `weekToDate` computation in
`app/api/body-metadata/route.ts` (week anchor + which columns) and mirror it exactly — a
different week anchor would make the tiles jump when the network response lands.

- [ ] **Step 3.4: Verify + commit**

`pnpm dev` renders unchanged (web sandbox has no local store — these paths are APK-only, state
this in the PR). Full gate. On-device (owner, post-merge): airplane mode → home paints sleep,
streak/week-strip and weekly tiles from local data. Commit
`feat(home): local-first seeds for sleep, trained-days and week-to-date`.

---

### Task 4: Render hygiene & orchestrator slimming

**Files:**
- Modify: `components/oura-score-chip-row.tsx`, `app/session-select/components/deload-banner.tsx`, `components/rest-day-card.tsx`, `components/home/early-deload-card.tsx`, `components/home/goals-checkin-card.tsx`
- Create: `app/session-select/components/log-value-sheet.tsx`, `app/session-select/components/week-day-sheet.tsx`
- Modify: `app/session-select/session-select-content.tsx`

- [ ] **Step 4.1: Memoize the five un-memoized home cards** *(HOME-11)*

Wrap `OuraScoreChipRow`, `DeloadBanner`, `RestDayCard`, `EarlyDeloadCard`, `GoalsCheckinCard`
in `React.memo`. Then stabilize their call sites — memo with unstable props is a silent no-op:
hoist `EarlyDeloadCard`'s inline `onConfirm`/`onDismiss` (`session-select-content.tsx:1059-1065`)
and `ExerciseDetectedCard`'s `onReview={id => setReviewingSessionId(id)}` (`:1053`) into
`useCallback`s next to the existing handler block (`:342-359`). `GoalsCheckinCard`'s
`onReviewNow`/`onRemindLater` are plain `async function` declarations re-created per render —
convert both to `useCallback`.

- [ ] **Step 4.2: Extract the two self-contained sheets** *(HOME-12; R6 PERF-12 cross-ref — owned here)*

Move the "Log value" sheet (`:1481-1511` + `logWidget`/`logValue`/`logSaving` state +
`handleSaveLog` + `openLog`) into `app/session-select/components/log-value-sheet.tsx`, and the
week-day overlay sheet (`:1388-1479` + `weekOverlay` state + `handleWeekDayClick`) into
`app/session-select/components/week-day-sheet.tsx`. Both become props-driven children
(`userId`, `metaToday`, `metaRecent`, `onSaved: () => {invalidate…; fetchMeta()}` for the log
sheet; `activeSessions`, `onExerciseTap: setHistoryEx` for the week sheet, which owns its own
`day-log:<date>` fetch). Pure moves — no behaviour change; keep the exact save semantics
(local-first write, outbox, optimistic fallback) byte-identical. This is a known regression
hotspot (per R6): keep the diff mechanical, no refactors beyond the move. Target: orchestrator
under ~1,200 lines this pass (honest partial progress on the 800 rule; further extraction rides
with R6 PERF-12).

- [ ] **Step 4.3: Verify + commit**

`pnpm dev`: quick-log a weight (sheet opens, saves, tile updates), tap a week-strip day
(overlay loads, exercise tap opens history sheet). React DevTools profiler: a mood-fetch
resolution no longer re-renders `OuraScoreChipRow`/`GoalsCheckinCard`. Full gate. Commit
`perf(home): memoize remaining home cards; extract log-value + week-day sheets`.

---

### Task 5: Home UI tokens, a11y and touch targets (non-R7 scope)

**Files:**
- Modify: `app/session-select/session-select-content.tsx`, `app/session-select/components/{recommendation-card,week-strip-card,metric-tiles-card}.tsx`, `components/home/{home-card-widget,goals-checkin-card,early-deload-card}.tsx`, `components/{readiness-card,body-battery-card}.tsx`
- Create: `lib/health/recovery-band.ts`

*(R7 owns: both nested-button banners + `DismissibleBanner`, emoji→Lucide, the `#fbbf24` mood
card, aria-expanded on its three named offenders. R8 owns the sleep-stage palette dedup. Don't
touch those here.)*

- [ ] **Step 5.1: `lib/health/recovery-band.ts`** — one home for the muscle-recovery band *(HOME-13 tail)*

```ts
/** Muscle-recovery band — thresholds + colors defined once (used by the home
 *  muscle-status widget and any Health surface showing recovery %). */
export function recoveryBand(pct: number): { key: 'recovered' | 'partial' | 'fatigued'; color: string } {
  if (pct >= 80) return { key: 'recovered', color: 'var(--accent-green, #22c55e)' }
  if (pct >= 50) return { key: 'partial',   color: 'var(--accent-amber, #f59e0b)' }
  return { key: 'fatigued', color: 'var(--accent-red, #ef4444)' }
}
```

Sibling-surface sweep first: grep for `pct >= 80` / the three hexes across `components/health/`
and `app/health/` — if another surface colours recovery % the same way, convert it in the same
commit. Use in `home-card-widget.tsx:305`. Verify the `--accent-*` custom properties exist in
`globals.css`; if not, use the closest existing tokens (do not invent new hex).

- [ ] **Step 5.2: Token fixes** *(HOME-13)*

- `session-select-content.tsx:1027` admin badge: `bg-red-500 text-white` → `bg-destructive text-destructive-foreground` (matches `bottom-nav.tsx:104`).
- `session-select-content.tsx:1489` Save button: `text-white` → `text-primary-foreground`.
- `goals-checkin-card.tsx:20`: `bg-brand … text-white` → `text-primary-foreground`.
- `early-deload-card.tsx:23`: `bg-amber-600 text-white` → tokened amber (`var(--accent-amber)` background with a dark tokened foreground, matching how R7 tokens the sibling amber card — check R7's plan for the exact token it standardizes on and reuse it).
- `home-card-widget.tsx:137` empty-donut ring `'rgba(255,255,255,0.1)'` → `'color-mix(in oklch, var(--foreground) 10%, transparent)'`; `:304` `bg-white/10` → `bg-foreground/10`.
- `week-strip-card.tsx:54,60` `text-white` → `text-primary-foreground` (verify against each `palette.dotClass` background in both themes at ≤640px).
- `recommendation-card.tsx:289-290` Start button `text-white` over the **user-picked** `_rtColor`: pick foreground by luminance. Check `lib/utils.ts`/`accentCardStyle` for an existing contrast helper; if none exists add `readableOn(hex): 'black' | 'white'` (YIQ formula) next to `accentCardStyle` and use it — a light swatch currently yields white-on-light.

- [ ] **Step 5.3: A11y toggles** *(HOME-14)*

`readiness-card.tsx:122-126` and `body-battery-card.tsx:88-91`: convert the expanding header
`<div onClick>` to a real `<button type="button" className="w-full text-left" aria-expanded={expanded}>`
**only if** the header contains no nested interactive controls (verify — if it does, use the
WebView-safe `<div role="button" tabIndex={0}>` + `onKeyDown` Enter/Space pattern instead, per
the CLAUDE.md nested-control rule).

- [ ] **Step 5.4: Touch targets ≥44px** *(HOME-14)*

Header reorder + refresh buttons (`session-select-content.tsx:985-1009`): `p-2` → `p-2 min-h-11
min-w-11 flex items-center justify-center` (icon size unchanged). APK-banner dismiss (`:1085`):
`p-1.5` → `p-2.5 -m-1` (bigger hit area, same visual). `metric-tiles-card.tsx:95` Log button:
add `min-h-11`. Avatar button (`:1013`) stays 36px visually — give it `after:absolute` expanded
hit area or accept (it's a large corner target; note the decision in the PR).

- [ ] **Step 5.5: Verify + commit**

`pnpm dev` at 384×854: light **and** dark theme pass over home — no white-on-light text, badge
legible, donut ring visible in light mode, muscle bars coloured with % labels intact. Keyboard:
tab to readiness/body-battery headers, Enter toggles, `aria-expanded` flips. Full gate. Commit
`fix(home): theme tokens, a11y toggles, touch targets`. On-device: S25 smoke per checklist §UI.

---

## Final steps (same PR as the last task, per CLAUDE.md)

- [ ] Bump `package.json` **patch** + `lib/changelog.ts` entry ("Home: faster refresh (ring
  drain instead of dead cloud sync), instant post-workout streak paint, offline home widgets,
  fewer re-renders, theme/a11y fixes").
- [ ] `docs/module-map.md`: one-line rows for `lib/health/recovery-band.ts` and the
  `ta:oura-ble-synced` event if kept.
- [ ] Journal entry + `projectOverview.md` update ride in the final implementation PR.

## Self-review notes

- Chunks are independently landable in queue order 1→5; each is its own commit; Task 1 and
  Task 2 are the perceived-freshness wins and can ship alone if a session runs short.
- Every step either contains the code or names the exact verify-first read (server semantics
  for calendar completed-only, `weekToDate` anchor, plugin drain-status field, `--accent-*`
  token existence) — those four reads are the only intentional deferrals, each bounded to one
  file.
- Findings NOT in any task are cross-referenced to their owning queued plan in the ownership
  table — none dropped.
