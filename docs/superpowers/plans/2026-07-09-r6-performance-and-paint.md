# R6 — Performance & Paint

**Source review:** `docs/reviews/2026-07-06-full-app-overview-review.md` §4 (batch R6),
findings PERF-1..12, each re-verified against current `main` on 2026-07-09 (line numbers
updated below; nothing was already-fixed — all twelve reproduce). **Branch:**
`perf/performance-and-paint`. This is **server/JS + client-only** work — every change ships
via Railway into the WebView with **no APK rebuild** (`pnpm dev` renders all of it). But the
two payoffs that matter here — a smaller home bundle (PERF-1/6) and killing 1 Hz whole-screen
re-renders (PERF-2/8) — are only truly measurable **on-device**; the web sandbox can't profile
bundle chunks or Samsung WebView compositing. So treat every render-hotpath item (Chunk 1, 2)
as **device-verify** per `docs/device-smoke-checklist.md`: green `pnpm dev` is necessary, not
sufficient (Canonical Runtime doctrine).

**⚠ ORDERING CONSTRAINT (do not reorder):** within Chunk 1, the **PERF-7 oura-section
lazy-initializer fix MUST land before the PERF-6 static-import of oura-related cards**.
`oura-section.tsx` holds five `readCacheSync`/`readTodayCacheSync` calls in `useState` lazy
initializers. Today they are *masked* because the component is dynamically imported with
`ssr: false` (it never renders on the server, so there is no hydration to mismatch). The moment
PERF-6 static-imports any oura-related card, those initializers become SSR hydration hazards.
Convert them to effect-seeding **first**. (PERF-6's plan keeps `OuraSection` itself dynamic —
it carries chart.js — so the strict coupling is: convert oura-section's initializers before
static-importing the *lightweight* cards that sit next to it.)

**Goal:** shrink the home/health bundles, stop the four documented 1 Hz whole-screen
re-renders, collapse the redundant Oura/health-trends/nutrition fetch storms, and make history
edit/delete feedback instant — all without changing any product behaviour.

Governing CLAUDE.md rules (Mobile UI & Performance): heavy widgets via `next/dynamic({ ssr:
false })`; a `loading:` skeleton on a cache-seeded card is a contradiction; seed in a
`useEffect`, never a `useState` lazy initializer; timers/rAF/`useCountUp`/`useElapsedSec` in the
**leaf** that displays the number; `React.memo` + stable props (memoize arrays/objects at the
call site); saves feel instant (UI feedback synchronous after the local write, never after
`await fetch`); stable client id keys, never `key={index}`.

---

## Chunk 1 — Bundle size + lazy-init ordering (PERF-7 → PERF-1 → PERF-6)

Do the three tasks **in this order**. Task 1 (PERF-7) is the prerequisite for Task 3 (PERF-6).

### 1. PERF-7 (high, latent) — cache reads out of `useState` lazy initializers

**`components/health/oura-section.tsx:73-88`** — five initializers (do these first, they are the
coupling constraint):

```ts
// CURRENT (73-88):
const [data, setData] = useState<OuraStatsResponse | null>(
  () => readCacheSync<OuraStatsResponse>('oura-stats'),
)
const [hrReadings, setHrReadings] = useState<HrReading[]>(
  () => readCacheSync<{ readings: HrReading[] }>(`oura-hr-day:${today}`)?.readings ?? [],
)
const [sleepWindow, setSleepWindow] = useState<HrSleepWindow | null>(
  () => readCacheSync<{ sleep: HrSleepWindow | null }>(`oura-hr-day:${today}`)?.sleep ?? null,
)
const [workoutSessions, setWorkoutSessions] = useState<WorkoutSession[]>(
  () => readCacheSync<{ sessions: WorkoutSession[] }>(`workout-sessions-day:${today}`)?.sessions ?? [],
)
const [trends, setTrends] = useState<HealthTrendsResponse['trends']>(
  () => readTodayCacheSync<HealthTrendsResponse>('health-trends-summary')?.trends ?? [],
)
```

Replace each initializer with a plain empty/null default and seed synchronously in a layout
effect that runs before paint (mirror `health-content.tsx`'s existing `useLayoutEffect` seed
pattern, and note the existing `useEffect`s at `:90-110` already revalidate over the network):

```ts
const [data, setData] = useState<OuraStatsResponse | null>(null)
const [hrReadings, setHrReadings] = useState<HrReading[]>([])
const [sleepWindow, setSleepWindow] = useState<HrSleepWindow | null>(null)
const [workoutSessions, setWorkoutSessions] = useState<WorkoutSession[]>([])
const [trends, setTrends] = useState<HealthTrendsResponse['trends']>([])

useLayoutEffect(() => {
  const s = readCacheSync<OuraStatsResponse>('oura-stats'); if (s) setData(s)
  const hr = readCacheSync<{ readings: HrReading[]; sleep: HrSleepWindow | null }>(`oura-hr-day:${today}`)
  if (hr?.readings?.length) setHrReadings(hr.readings)
  if (hr?.sleep) setSleepWindow(hr.sleep)
  const ws = readCacheSync<{ sessions: WorkoutSession[] }>(`workout-sessions-day:${today}`)
  if (ws?.sessions?.length) setWorkoutSessions(ws.sessions)
  const tr = readTodayCacheSync<HealthTrendsResponse>('health-trends-summary')
  if (tr?.trends) setTrends(tr.trends)
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

**`app/session-select/session-select-content.tsx:139-162`** — the `recommendation` initializer
(`:139-146`, reads `sessionStorage.getItem('ta_recommendation_v1')` + `readCacheSync('next-session')`)
and the `moodLog` initializer (`:160-162`, reads `readCacheSync('mood:<today>')`). These are on
an SSR'd component with a `typeof window === 'undefined'` guard, so they return `null` on the
server and a cached value on the client — exactly the hydration mismatch the rule forbids. The
component's layout-effects already re-seed both, so the initializers carry pure hydration risk
with no benefit. Move both reads into the existing seed effect; default the state to `null`.

**`app/health/health-content.tsx:171-191`** — three `localStorage` initializers (`waterGoalMl`
`:171-177`, `targetWeightKg` `:178-184`, `targetBfPct` `:185-191`). Same treatment: default to
the constant, read `localStorage` in the seed layout-effect.

Governing rule: *"Seed in a `useEffect`, never in a `useState` lazy initializer — cache reads in
initializers caused React hydration mismatches (session 165)."*

**Verify:** `pnpm dev`, open Health and Home, hard-reload — no React hydration warning in the
console; cards still paint seeded (no skeleton flash). Then re-check after Task 3 static-imports
land (oura-section stays dynamic, but the lightweight neighbours no longer flash).

### 2. PERF-1 (med-high) — chart.js leaked into the home bundle

`components/day-review-sheet.tsx:9` statically imports `WorkoutLoadComparisonChart` (→ chart.js):

```ts
// CURRENT (:9)
import { WorkoutLoadComparisonChart, type LoadComparisonEntry } from "@/components/health/workout-load-comparison-chart";
```

The sheet is itself statically imported into Home (`session-select-content.tsx:40
import { DayReviewSheet } from "@/components/day-review-sheet"`), so chart.js rides into every
home page load. The file already dynamic-imports its other heavy children (`Response` `:11`,
`HrDayChart` `:12`) — this one was missed. One-line fix (keep the type import static, lazy the
component):

```ts
import type { LoadComparisonEntry } from "@/components/health/workout-load-comparison-chart";
const WorkoutLoadComparisonChart = dynamic(
  () => import("@/components/health/workout-load-comparison-chart").then(m => m.WorkoutLoadComparisonChart),
  { ssr: false },
);
```

The chart already only renders behind `loadEntries && sessionName` (`:66`), so no skeleton is
needed. Governing rule: *"Heavy widgets (chart.js, …) load via `next/dynamic({ ssr: false })`."*

**Verify:** `pnpm dev` + `pnpm build`; confirm chart.js is no longer in the home entry chunk
(inspect the build output / a `next build` chunk report). Open Home → "Your Day in Review" → the
load-comparison chart still renders once a session exists. **Device-verify** the bundle win.

### 3. PERF-6 (medium) — dynamic `loading:` skeletons defeat cache seeds on lightweight cards

**Only after Task 1 lands.** Five cards in `app/health/health-sections.tsx` are dynamically
imported *with a `loading:` skeleton* despite carrying no heavy deps (verified: no chart.js /
KaTeX / markdown) — the chunk-load skeleton wins the first-paint race against the card's own
cache seed:

```ts
// CURRENT (:38-65): all five have `loading: () => <div className="h-32 animate-pulse …" />`
const AiWeeklyVolumeCard  = dynamic(… , { ssr: false, loading: () => <div className="h-32 animate-pulse rounded-xl bg-muted" /> });  // :38-41
const StrengthProgressCard = dynamic(… , { ssr: false, loading: … });  // :50-53
const StrengthTrendCard    = dynamic(… , { ssr: false, loading: … });  // :54-57
const GoalsProgressCard    = dynamic(… , { ssr: false, loading: … });  // :58-61
const TrendsSection        = dynamic(… , { ssr: false, loading: … });  // :62-65
```

Convert these five to **static imports** (they cache-seed synchronously, so they paint
last-known data instantly with no skeleton). **Keep `OuraSection` (`:30-33`) and `InjuryCard`
(`:34-37`) dynamic** — `OuraSection` pulls in chart.js (`HrDayChart`/`TrendSparkline`).
`WorkoutDensityCard` (`:42-45`) and `NutritionActivityTrendsCard` (`:46-49`) are dynamic but have
no `loading:` skeleton, so they don't hit the contradiction — leave them dynamic (they only pull
`TrendSparkline`, which is itself lazy via `trend-sparkline-lazy`).

**`app/session-select/session-select-content.tsx:44-47`** — `BodyBatteryCard` is dynamic with a
`loading: () => <Skeleton className="mx-4 mb-3 h-[68px]" />`. It cache-seeds; static-import it and
drop the skeleton.

Governing rule: *"A `loading:` skeleton on a cache-seeded card is a contradiction (the skeleton
wins and defeats the cache-seed instant-paint rule)."*

**Verify:** `pnpm dev`, open Health and Home on a repeat visit (caches warm) at ≤640 px — the
five health cards + Body Battery paint their seeded values with **no** grey skeleton flash. No
hydration warning (relies on Task 1). **Device-verify** the paint on the S25.

---

## Chunk 2 — 1 Hz / memo-defeat render hotpaths (PERF-2, PERF-8)

Every item here is a timer forcing a large subtree to re-render each second. These are the
render-discipline core; **device-verify** each.

### 1. PERF-2 (med-high) — MuscleHeatmap re-rendered at 1 Hz on the warmup screen

`components/workout/warmup-screen.tsx` self-ticks via `useElapsedSec(workoutStartMs)` at `:23`
(the warmup-timer bar updates every second), and rebuilds the `assignments` array **fresh every
render** at `:47-54`, feeding it into the memoized `<MuscleHeatmap>` at `:134` — defeating the
memo, so the heatmap re-renders at 1 Hz. The exact fix already exists in the sibling
`active-workout-screen.tsx:176-181` (memoized, with a comment naming this failure):

```ts
// active-workout-screen.tsx:176-181 (reference):
// Stable identity so the memoized MuscleHeatmap doesn't re-render on every
// 1Hz session-clock tick — this array previously was rebuilt fresh each render.
const muscleMapAssignments = useMemo<MuscleActivation[]>(() => [ … ], [exercise?.mainMuscles, exercise?.secondaryMuscles]);
```

Apply the same in `warmup-screen.tsx` — wrap the `muscleMap` build + `assignments`/
`primaryMuscles` derivations in a `useMemo` keyed on the exercises' muscle arrays:

```ts
const { assignments, primaryMuscles } = useMemo(() => {
  const muscleMap = new Map<string, "main" | "secondary">();
  for (const ex of exercises) {
    for (const m of ex.mainMuscles ?? []) muscleMap.set(m, "main");
    for (const m of ex.secondaryMuscles ?? []) if (!muscleMap.has(m)) muscleMap.set(m, "secondary");
  }
  return {
    assignments: [...muscleMap.entries()].map(([muscle, role]) => ({ muscle, role })) as MuscleActivation[],
    primaryMuscles: [...muscleMap.entries()].filter(([, r]) => r === "main").map(([m]) => m),
  };
}, [exercises]);
```

Ideally also move the 1 Hz tick into a leaf (the warmup-timer bar) so the whole screen doesn't
re-render at all — but the minimal, low-risk fix is the `useMemo` (matches the sibling exactly).
Governing rule: *"Any card/widget rendered repeatedly … gets `React.memo`, **and** its call site
passes stable props — an inline arrow or object literal defeats the memo silently."*

**Verify:** `pnpm dev`, start a workout → Warm Up screen; the timer bar counts up while the
heatmap does not re-render (add a temporary `console.count` in MuscleHeatmap to confirm it fires
once, then remove). **Device-verify** on the S25.

### 2. PERF-8 (low-med) — timers/rAF in non-leaf components

- **`components/stats/weekly-stats-hub.tsx:16-17`** — two `useCountUp` at the hub top
  (`sessionsCount`, `setsCount`) re-render the entire hub (the day-volume bars at `:33`+ and all
  four `STAT_CARDS`) on every animation frame. Push each count-up into the leaf tile that
  displays it (a small `<CountUpValue value={data.totalSessions} />` component that calls
  `useCountUp` itself), so only the two numbers animate. Governing rule: *"call `useCountUp`/
  `useElapsedSec` in the leaf that displays the number, never at the top of a screen."*
- **`components/activity/active-activity-screen.tsx:29-41`** — a 1 Hz `setInterval` sets
  `elapsedSec` on the whole screen (`:36`) even though a leaf `session-clock.tsx`/`useElapsedSec`
  already exists in the codebase. Move the elapsed readout into a leaf component that owns the
  tick (mirror how `warmup-screen`/`active-workout-screen` consume `useElapsedSec`). Note this
  screen accounts for accumulated pause time, so the leaf must take `startMs`,
  `accumulatedPauseMs`, `isPaused`, `pauseStartMs` and compute elapsed itself.
- **`components/ui/meteors.tsx:38`** — `setInterval(generateMeteors, 3000)` permanently
  regenerates and re-renders the meteor DOM every 3 s wherever it mounts (it decorates the home
  surface). The regeneration is cosmetic (positions reshuffle) — generate **once** on mount and
  drop the interval (the CSS animation already loops), or gate it behind an off-screen
  `IntersectionObserver`. Simplest: delete the `setInterval` and keep the single
  `generateMeteors()` call at `:37`.

**Verify:** `pnpm dev` — Stats hub numbers still count up; Activity screen timer still ticks
(with pause handled); Home meteors still animate but the DOM node set is stable (no 3 s churn in
the Elements panel). **Device-verify** the Home idle-CPU / meteor churn on the S25.

---

## Chunk 3 — Redundant fetch storms & rogue throttles (PERF-3, PERF-4, PERF-5)

Pure request-count reductions; verifiable in `pnpm dev` via the Network panel.

### 1. PERF-3 (medium) — third, rogue Oura sync throttle on home mount

> **Superseded (2026-07-10):** the home-page freshness plan
> (`docs/superpowers/plans/2026-07-10-home-page-freshness-and-performance.md`, Task 1.3) goes
> further than re-throttling — it **removes** this Cloud sync call entirely (the Oura Cloud is
> frozen post-re-key, so the sync can never return new data) and converts the workouts GET to
> `cachedFetch`. If that plan has landed, **skip PERF-3 here**; if implementing R6 first, do
> PERF-3 as written and the home plan's task becomes a no-op.

`components/activity/exercise-detected-card.tsx` (rendered on Home via
`session-select-content.tsx:49-52`) does two wasteful things on every home mount:

- **`:62-73`** — fires `POST /api/oura/sync` (which hits **5 Oura endpoints server-side**) behind
  its **own** 5-minute key `ta_oura_workout_sync_ms`, bypassing the shared 6 h throttle
  (`OURA_LAST_SYNC_KEY`) that `sync-provider.tsx` and Health deliberately share.
- **`:51`** — `fetch('/api/oura/workouts?unreviewed=true')` bare (no `cachedFetch`) on every
  mount.

Fix (a): route the sync through the shared throttle. Grep for `OURA_LAST_SYNC_KEY` /
`invalidateOuraSync` usage in `components/sync-provider.tsx` and reuse the same key + interval
here (or better, let SyncProvider own Oura sync and have this card only *read*). At minimum,
replace the local `THROTTLE_KEY`/5-min gate with the shared 6 h key so a home visit doesn't
re-drain Oura every 5 minutes. Fix (b): convert the `:51` GET to `cachedFetch` with a named key
(e.g. `oura-unreviewed-workouts`, `TTL_MEDIUM`) so repeat mounts hit the cache.

Governing rule (module-map / cache): one canonical throttle per shared job; client GETs of
`/api/*` use `cachedFetch`, never bare `fetch`.

**Verify:** `pnpm dev`, Network panel — first Home mount fires at most one `oura/sync` (only if
>6 h since the shared key); subsequent mounts within the window fire none; the workouts GET is
served from cache on the second mount.

### 2. PERF-4 (medium) — `health-trends-summary` fetched by 4 sibling cards per Health open

Four separately-mounted (some dynamic-chunked) cards each call
`cachedFetchToday('health-trends-summary', '/api/health/trends', TTL_LONG, …)`:

- `components/health/oura-section.tsx:94`
- `components/health/workout-density-card.tsx:15`
- `components/health/nutrition-activity-trends-card.tsx:15`
- `components/health/health-score-detail.tsx:150`

Because the dynamic chunks mount at different times, the in-flight dedup in `cachedFetch` can't
collapse them → up to four network hits per Health open. Fetch **once** in the parent
(`app/health/health-content.tsx`, which already orchestrates the health screen and holds the
seed effects) and pass `trends` (or the derived slices each card needs) down as props. Each card
keeps a prop default so it still renders if the parent hasn't resolved. Governing rule:
sibling-surface sweep + one fetch per key.

**Verify:** `pnpm dev`, open Health, Network panel — exactly **one** `/api/health/trends`
request per open; all four cards still render their sparklines/tiles.

### 3. PERF-5 (medium) — nutrition date-swipe refetch storm

`app/nutrition/nutrition-content.tsx:244` (`useEffect(() => { fetchData(selectedDate); },
[fetchData, selectedDate])`) re-runs **all 8** endpoints in `fetchData` (`:188-231`) on every
`selectedDate` change, but only `loadFoodLogs(today)` (`:206`) is date-dependent — the other
seven (`nutrition-meal-types`, `nutrition-targets`, `nutrition-weekly-summary`,
`nutrition-adherence`, `body-metadata`, `progress-summary`, `nutrition-user-profile`) are
mount-scoped. Browsing back 5 days ≈ 40 requests.

Split the effect: run the seven date-independent fetches **once per mount** (an effect keyed on
`[userId]`), and run only `loadFoodLogs(date)` on `[selectedDate]`. Also, the date-swipe handler
blanks the list before fetching at **`:328`** and **`:332`** (`setLogs([])`), defeating the
per-date `loadFoodLogs` cache seed and forcing an empty flash — remove the `setLogs([])` calls
and let `loadFoodLogs` seed the new date from cache synchronously (it already reads
local-first/cache). Keep the calsBurnedToday local read where it is.

Governing rule: instant paint (no blank flash on a cache-seeded read); no redundant fetches.

**Verify:** `pnpm dev`, Nutrition, swipe back several days — Network panel shows one
`food-logs` request per day and **no** re-fetch of targets/meal-types/etc.; the macro ring
repaints from cache without a blank flash.

---

## Chunk 4 — workout-data N+1 prefetch collapse (PERF-9) — *larger, optional, land last*

**Risk note:** this is the biggest and riskiest item (touches the hot workout-data route + the
home prefetch loop that every session tab depends on). Land it **on its own**, after Chunks 1–3,
and only if the request-count win justifies the churn. Safe to defer as a standalone follow-up.

`app/api/workout-data/route.ts` re-runs the full program/library/PR query set **per session
tab**: the shared `getActiveProgram` + `listProgressionStyles` + `listExerciseLibrary` at
`:82-86`, plus per-session `listProgramPhases` / `getLastExerciseLogsBatch` /
`getDayExerciseNames` / `getSessionPeriodization` / `listPersonalRecords` at `:143-149`. Home
prefetches every session's tab, so a cold cache costs **N+1 heavy requests** (one per session
plus meta).

Design a `?tab=all` batch variant: fetch the shared data once, then map every session's
per-session block in a single response `{ perSession: Record<sessionId, WorkoutSessionData> }`.
Client prefetch issues one `workout-data?tab=all` and seeds each per-session `workout-data:<id>`
cache key from the batch. Keep the existing per-tab route for the active-tab revalidate path
(and for backward-compat with any cache seed already keyed per tab). Preserve the SWR header
(`:92`) and the phase-status derivation semantics exactly.

Related light overlaps (note only — fold in opportunistically, don't expand scope):
`calendar-data` + `streak-data` recompute the current month twice; `body-battery` +
`readiness-score` independently query near-identical `body_metrics`/sleep rows; the admin
pending-count is fetched at 2 sites (CACHE-F17 hygiene).

Governing rule: server routes parallelize; avoid N+1 round-trips; one canonical cache key per
endpoint.

**Verify:** `pnpm dev` against the local seeded DB (Push/Pull/Legs), cold cache — Home prefetch
fires **one** `workout-data?tab=all` instead of 3+; opening each session tab paints from the
batch-seeded cache; phase labels/`loggedTodayInThisSession` still correct. Load-test the batch
route against a realistic program before merge (per the DB connection-pool rule).

---

## Chunk 5 — Paint/keys/extractions (PERF-10 cross-ref, PERF-11, PERF-12)

### 1. PERF-10 (medium) — day-overlay edit/delete waits on the network for feedback

**Cross-ref / split ownership:** the *offline-first* half of this finding (add a local-store
write + outbox path so the edit/delete works offline and survives remount) overlaps
**SYNC-R4 / SYNC-C1 in batch R3** and is **owned by R3** — do not duplicate the outbox/tombstone
work here. This chunk owns only the **render/paint** half: make the UI feedback synchronous.

- `app/health/health-content.tsx:537-615` (`handleEditSave` `:537-552`, `handleDelete` `:554-576`,
  `handleDeleteSession` `:578-597`) — each `await fetch(...)` then toasts/`setEditEx(null)` only
  **after** the round-trip. Flip to feedback-first: close the dialog + toast synchronously, then
  fire the network write and reconcile on error (mirror the log-exercise reference pattern). The
  actual local-store write is R3's job; when R3 lands, these call sites converge on the shared
  path.
- `app/stats/stats-content.tsx:117-151` (`handleEditSave` `:117-133`, `handleDelete` `:135-151`) —
  same drift, same fix. Sibling-surface sweep: fix both in the same PR.
- `components/health/metric-log-sheet.tsx:119-129` — the web fallback toasts **after** `await
  fetch` (`:120` await → `:126` toast), while the same fallback in session-select is
  feedback-first. Align to feedback-first.

Governing rule: *"UI feedback — toast, mode flip … — fires synchronously after the local write,
never after `await fetch`."* Note in the PR that the offline/outbox completion depends on R3.

**Verify:** `pnpm dev`, Health/Stats day overlay → edit a set / delete → the toast and dialog
close **instantly**, not after the network resolves; on a forced 500 the error toast still
surfaces and the overlay reconciles.

### 2. PERF-11 (low) — `key={index}` in the two set-edit dialogs

`app/health/health-content.tsx:837` and `app/stats/stats-content.tsx:350` both render
`editEx.weights.slice(...).map((w, i) => <div key={i} …>`. No live bug today (controlled inputs,
fixed row count) but keying by the set number is free and correct:

```ts
// key={i}  →  key={`set-${i + 1}`}   (or the set's stable id if one exists on editEx)
```

Governing rule: *"Rows in editable lists get a stable client id at creation, never
`key={index}`."*

**Verify:** `pnpm dev`, open a set-edit dialog, edit values — no regression (inputs stay bound
to the right set).

### 3. PERF-12 (info) — file sizes & dead import

No *new* files over the ~800-line ceiling, but `session-select-content.tsx` keeps absorbing
features. Current sizes (2026-07-09): `session-select-content.tsx` **1504**, `workout-screen.tsx`
1277, `health-content.tsx` 1132, `health-sections.tsx` 972, `config-screen.tsx` 964,
`program-editor-sheet.tsx` ~959.

- **Free win:** delete the **dead import** `OuraBatteryChip` at
  `session-select-content.tsx:21` (imported, never rendered — grep confirms the import is its
  only occurrence).
- **Low-priority extractions (mark carefully — session-select is a known regression hotspot;
  extract behind unchanged props, verify on device):** the recommendation/mood block and the
  week-day overlay sheet are the easiest lifts into `app/session-select/components/` children.
  Do these **only** as isolated, behaviour-preserving moves — never bundle them with the logic
  changes above.
  **Ownership note (2026-07-10):** the week-day overlay sheet + log-value sheet extractions are
  now owned by the home-page freshness plan
  (`2026-07-10-home-page-freshness-and-performance.md`, Task 4.2) — skip them here if that plan
  has landed; the dead-import deletion above stays R6's.

Governing rule: *"Component files stay under ~800 lines … extract new features into
`components/` children."*

**Verify:** `pnpm dev` + `pnpm build` green after the dead-import removal; any extraction is a
pure move (diff shows no behaviour change) and the Home screen renders identically at ≤640 px and
on the S25.

---

## Not in scope (owned elsewhere / already fixed)

- The **UI-H1 canvas-CSS-var-renders-black** bug in `workout-load-comparison-chart.tsx` (paired
  with PERF-1 in the exec summary) is **batch R7**, not R6 — do not fix it here.
- The **offline/outbox + tombstone** half of PERF-10 is **batch R3** (SYNC-R4 / SYNC-C1).
- Nothing in §4 was already fixed on `main` — all twelve findings reproduce as of 2026-07-09
  (line numbers above are the re-verified current locations).
