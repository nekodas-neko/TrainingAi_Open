# Per-set / per-exercise HR metrics — capture, persist, trend (plan, 2026-07-21)

**Owner-directed (2026-07-21).** Now that live HR recording (Polar H10 chest strap + direct-BLE Oura
ring) is consistent, the owner wants full-granularity HR analytics **per set, per exercise, over
time**: max/avg HR during each set, the beat-drop during the rest that follows, how long HR takes to
return to normal, and how all of this trends — sliced by exercise and by the set's phase/intensity %.
Motivating questions the feature must answer:

- "Max / average peak HR during **Bench Press**, over time."
- "During this exercise **at this phase / %1RM**, HR drops **X beats** during rest" → a *cardiovascular*
  read on rest sufficiency (explicitly **not** CNS/neuromuscular recovery — see the labelling rule).
- The running-interval idea ("1 min work / 1 min rest, how long to return to normal") generalised to
  **every** logged set.

**Owner decisions (asked & answered this session):**
1. **Recovery model → capture all three.** Store time-to-recover under all three "recovered"
   definitions (return-to-pre-set-HR, return-to-resting-HR, %HRR-recovered) so we can compare which is
   most useful on real data before committing to one.
2. **Scope → record + display + insight only.** Persist the metrics, show them on the recap and as
   per-exercise trends, surface a read-only "rested enough / cut short" flag. **No** change to the
   in-session rest-timer behaviour (no auto-nudge) in this scope.

---

## 1. What already exists (do NOT rebuild)

Everything needed to compute these metrics is **already captured** — the gap is purely that per-set HR
is computed transiently on the recap and then discarded, with no durable store and no per-exercise
trend surface.

| Ingredient | Where | Notes |
|---|---|---|
| Raw beat HR (1 Hz during workouts) | `oura_heartrate` (`schema.ts:733`) — `{userId, timestamp, bpm, source}` | `source` ∈ `chest_strap` / `ble` / oura-cloud. **Pruned ~180 d** (throttled write-path prune, no cron). |
| Beat-to-beat RR (HRV material) | `rr_intervals` (`schema.ts:777`) | Pruned ~90 d. |
| Per-set timing + prescription | `set_logs` (`schema.ts:184`): `setStartMs`, `setEndMs`, `restTimeSec`, `intensityPct`, `plannedPct`, `plannedRestSec`, `rpe`, `weightKg`, `reps`, `setNumber`, `useFor1rm` | The working-set window + actual/planned % + rest taken are **already stored per set**. |
| Exercise identity | `exercise_logs` (`schema.ts:164`): `exerciseName`, `exerciseId`, `styleName`, `styleId` | The join key for per-exercise trends. |
| Phase | `workout_sessions` (`schema.ts:144`): `phaseId`, `phaseType`, `intensityMode` | Session-level phase context. |
| Transient per-set HR compute | `lib/workout/hr-analysis.ts` → `analyseHrRecovery()` → `{peakBpm, bpmAtLog, hrr1, adequate}` | **Not persisted.** `hrr1 = bpmAtLog − bpm60s`. This is the seed of the new formula module. |
| Durable **per-session** snapshot (the precedent to copy) | `workout_hr_stats` (`schema.ts:763`, migration 135); computed in `compute-workout-hr.ts`; persisted fire-and-forget COALESCE-upsert in `app/api/oura/hr-data/route.ts:29`; falls back to snapshot after the raw series is pruned | **This is the exact pattern the new per-set table follows** — server-derived, keyed by workout, computed on first recap view, durable past the 180 d prune. |
| Existing trend rollup precedent | `lib/workout/hrr-trend.ts` (14-day HRR, session-median → daily-best) | Reuse the "derive, don't store the rollup" shape. |
| HRmax / RHR baselines | `lib/health/observed-hr.ts` (observed max/avg/%-of-max), `body_metrics.restingHeartRate`, VO₂max's HRmax handling in `lib/health/vo2max.ts` | Baselines the recovery-model needs — **import, never re-derive** (One Formula One Place). |

**Key architectural fact:** HR is joined to sets by **timestamp window at read time**, not a stored FK.
`computeWorkoutHr` (`compute-workout-hr.ts:24`) already reads `getHrForWindow` + `getSetTimestampsForSession`
and runs `analyseHrRecovery`. We extend that same shared path.

---

## 2. The gap this plan closes

1. **No durable per-set HR store.** Per-set peak/drop/recovery is recomputed live and thrown away; the
   180 d `oura_heartrate` prune then erases the ability to recompute it for older workouts.
2. **Recovery model is one number (hrr1 @ 60 s).** No fixed-interval drop curve, no time-to-recover, no
   phase/%-sliced view.
3. **No per-exercise trend surface.** Nothing lets the owner see "Bench peak HR / recovery over time".

---

## 3. Design

### 3.1 New durable table — `set_hr_stats` (migration 139)

Server-derived, **keyed by `set_log_id`**, mirroring `workout_hr_stats` exactly: computed on first
recap view when live readings exist, persisted COALESCE-upsert (a fuller later compute wins, a partial
never clobbers), **not** an offline-first sync domain (no local table, no outbox, no `pushMutations`
branch — same as `workout_hr_stats`). This is the whole point: it must **outlive the 180 d raw prune**,
so it is **not pruned** (or pruned only on a very long horizon).

> Migration number: **137** (`135_workout_hr_stats.sql` is latest on disk; `136` is claimed by the
> `ai_call_log` B1 backlog item; `130` is a pre-existing gap — do NOT reuse it. Claim 137 against the
> directory *and* any open PR/plan per the CLAUDE.md migration rule.)

**Columns.** Denormalise the trend dimensions at compute time (snapshot), so trend queries stay cheap
*and* keep working after the raw series and even parent rows change:

```
set_hr_stats
  set_log_id          uuid PK  → set_logs.id (on delete cascade)
  user_id             uuid     (scoped on every read/write)
  workout_session_id  uuid     → workout_sessions.id (on delete cascade)   -- convenience join
  exercise_log_id     uuid                                                  -- convenience join
  -- denormalised trend dimensions (snapshot at compute) --
  exercise_id         uuid null       -- exercise_logs.exercise_id (trend key; name fallback)
  exercise_name       text            -- exercise_logs.exercise_name (for library-less exercises)
  phase_type          text null       -- workout_sessions.phase_type
  set_number          int
  intensity_pct       double null     -- actual %1RM for the set (set_logs.intensity_pct)
  planned_pct         double null     -- planned %1RM (set_logs.planned_pct)
  rest_taken_sec      int null        -- set_logs.rest_time_sec (rest actually taken)
  planned_rest_sec    int null        -- set_logs.planned_rest_sec
  logged_at           timestamptz
  -- HR during the set --
  peak_bpm            int null        -- max HR in the working-set window
  avg_bpm             int null        -- mean HR in the working-set window
  bpm_at_end          int null        -- HR at set end / log time
  -- drop during rest (the "HR drops X beats" curve) --
  drop_30s            int null        -- bpm_at_end − HR 30 s after set end
  drop_60s            int null
  drop_90s            int null
  drop_120s           int null
  trough_bpm          int null        -- lowest HR reached during the rest that follows
  -- time-to-recover, ALL THREE definitions (owner: capture all three) --
  sec_to_preset       int null        -- s until HR ≤ pre-set baseline HR
  recovered_preset    bool null       -- did it reach pre-set within the rest window? (censoring flag)
  sec_to_resting      int null        -- s until HR ≤ day resting HR (RHR)
  recovered_resting   bool null
  pct_hrr_at_rest_end double null      -- %HRR recovered by the time the next set started (Karvonen)
  sec_to_hrr50        int null        -- s to cross 50% HRR recovered
  -- rest-sufficiency (cardiovascular only) --
  rest_adequate       bool null       -- HR-recovery adequacy flag (see §3.4) — NOT CNS readiness
  -- data quality --
  readings_count      int  not null default 0
  coverage_ok         bool not null   -- enough non-sparse samples in the window to trust the numbers
  source              text null        -- chest_strap | ble | mixed
  computed_at         timestamptz not null default now()
```

**Censoring is explicit.** A rest period that ends before HR recovers is the norm for heavy sets —
store `sec_to_* = null` **with** the `recovered_*` bool = false and `rest_taken_sec`, so a null reads as
"did not recover within the rest taken", never as missing data. The %HRR-recovered-at-rest-end column
gives a non-censored continuous signal for exactly those cut-short cases.

### 3.2 One formula, one place — `lib/workout/set-hr-stats.ts` (new)

All per-set HR math lives here, computed from `(readings, setMarkers, baselines)`. This **absorbs and
extends** `analyseHrRecovery` — do not leave two hrr1 implementations (One Formula One Place). Refactor
`hr-analysis.ts` to re-export / delegate, or fold it in and update the two call sites
(`compute-workout-hr.ts`, and the `hrr-trend.ts` consumers via the session route).

Refinements over the current transient compute:
- **Peak/avg over the true working-set window** (`setStartMs`→`setEndMs`) when present; fall back to the
  existing "90 s before `logged_at`" proxy for older/seeded sessions that lack per-set timing. Record
  which fidelity was used implicitly via `coverage_ok` + window availability (note the mixed-fidelity
  caveat in the journal — trends mix true-window and proxy peaks for pre-timing sessions).
- **Drop curve** at 30/60/90/120 s after set end (nearest-reading within a tolerance; null if no sample).
- **Three recovery definitions** as above. `sec_to_preset` uses the HR sampled just before `setStartMs`
  as baseline; `sec_to_resting` uses the day's RHR (`body_metrics.restingHeartRate`, null → metric null);
  `%HRR` uses Karvonen `(peak − now)/(peak − RHR)` with HRmax/RHR from the shared health baselines.
- **Coverage gate:** null every derived metric when sample density in the relevant window is too sparse
  (define a threshold: e.g. < N samples or a gap > X s across the set+rest span) and set `coverage_ok=false`.

Pure and deterministic (same inputs → same output), like `summariseWorkoutHr`, so the recap route and
the admin backfill share it and can never drift.

### 3.3 Compute + persist path (extend, don't fork)

- Extend `computeWorkoutHr` (`compute-workout-hr.ts`) to also return `setHrStats[]` from the new module
  (it already has `readings` + `sets`; add the baseline fetch — RHR for the day, HRmax).
- In `app/api/oura/hr-data/route.ts`, alongside the existing per-session `upsertWorkoutHrStats`, add a
  fire-and-forget **batch** `upsertSetHrStats(userId, rows)` (COALESCE-upsert, fuller-wins) when
  `readings.length > 0`. Same durability contract as the session snapshot.
- **Backfill:** extend/mirror `app/api/oura-ble/backfill-hr-stats/route.ts` (admin) to populate
  `set_hr_stats` for existing completed sessions **still inside the 180 d window** — the sooner this runs,
  the more history is captured before the raw series thins. Note the capture-urgency in the PR.

### 3.4 Rest-sufficiency insight (read-only, correctly labelled)

Keep the existing adequacy heuristic (`hrr1 ≥ 15` or `bpm_at_end < 120`) as `rest_adequate`, now
persisted, and add a per-set/per-exercise "rested enough vs cut short" read comparing recovery achieved
against `rest_taken_sec`. **Every surface that shows this must label it as *cardiovascular / HR*
recovery, not CNS or neuromuscular readiness** — this is the owner's explicit caveat ("can't count CNS
rest"). A short one-line disclaimer on the card. No rest-timer behaviour change.

### 3.5 Repository additions (all user-scoped)

`lib/data/repository.ts` + `lib/data/postgres/adapter.ts` (+ a `slices/` file):
- `upsertSetHrStats(userId, rows: SetHrStatsRow[])` — batch COALESCE-upsert, `setWhere` user-scoped.
- `getSetHrStatsForSession(userId, workoutSessionId)` — recap enrichment.
- `getSetHrStatsForExercise(userId, { exerciseId?, exerciseName?, sinceDays })` — trend feed, ordered by
  `logged_at`. Optional group-by `phase_type` / `intensity_pct` bucket done in the read helper (derive,
  don't store the rollup — mirror `hrr-trend.ts`).

### 3.6 Read API — `GET /api/workout/exercise-hr-trend` (new)

- Params: `exerciseId` (or `exerciseName`), `days`. Route the date/window through the standard helpers;
  add the **SWR headers at creation** (`Cache-Control: private, max-age=60, stale-while-revalidate=120`)
  and the **standard rate limit** matching sibling `app/api/oura/*` / `app/api/hr-*` routes.
- Returns per-session points for the exercise: `{date, avgPeakBpm, avgBpm, avgDrop60, secToPreset,
  secToResting, pctHrrAtRestEnd, phaseType}` plus a `byIntensityBucket` breakdown (e.g. 70/80/90 %) so
  the UI can answer "at 90 % you drop 22 bpm/60 s; at 70 % you drop 31".
- Prefer the durable `set_hr_stats` snapshot; for in-window sessions with no snapshot yet, compute-on-read
  via the shared path (and opportunistically persist).

### 3.7 UI

- **Exercise-detail / exercise-history HR card** (`components/…exercise-history…` — locate the existing
  Session-Log sheet; the W4 backlog note references `exercise-history-sheet.tsx`): a new "Heart &
  Recovery" card showing (a) peak HR per session over time, (b) drop@60 s / recovery trend, (c) the
  per-%1RM / per-phase breakdown, (d) the rest-sufficiency flag with the cardiovascular-only label.
  Must follow the repo UI rules: **cache-seed instant paint** (`readCacheSync` seed in a `useEffect`, no
  skeleton), `React.memo` + stable props, theme **tokens** (no hex), **`resolveColor`** for any
  chart/canvas colour (never a `var(--x)` string into canvas), Lucide icons, safe-area utilities if it's
  a full-screen/sheet surface, sparkline via the shared `components/ui/sparkline.tsx` primitive (do not
  add a new inline polyline). Chart via `react-chartjs-2` behind `next/dynamic({ssr:false})`.
- **Recap per-set enrichment** (`app/api/oura/hr-data` already feeds the recap): surface the richer
  per-set metrics (peak, avg, drop curve, recovery, adequate) using the now-persisted values.

### 3.8 Optional follow-up (out of scope, note only)

Expose the trend via an AI-chat tool (`lib/ai-chat/tools.ts`) so the assistant can answer "how's my
bench HR recovery trending?" — deterministic query, anchored at `todayMidnightUtc(tz)` (never a ms
offset). Flag as a small follow-up PR, not part of this scope.

---

## 4. Suggested PR split (each its own PR, per backlog convention)

- **PR A — capture + persist (take first; capture is time-sensitive vs the 180 d prune).**
  Migration 139 + `schema.ts` + `lib/workout/set-hr-stats.ts` (the one formula, absorbing
  `analyseHrRecovery`) + `compute-workout-hr.ts` extension + repo `upsertSetHrStats`/getters + persist in
  `hr-data` route + admin backfill route. Unit tests + a DB-backed test. **No UI.** Starts durable
  accumulation immediately.
- **PR B — read + surface.** `exercise-hr-trend` route + exercise-detail HR card + recap per-set
  enrichment + the rest-sufficiency insight flag (correctly labelled).
- **PR C (optional) — AI-chat tool** exposure.

## 5. Testing / verification

- **Pure unit tests** for `set-hr-stats.ts` (mirror `oura-workout-hr-stats.test.ts`): synthetic readings
  → expected peak/avg/drop-curve/recovery-times; **censoring** (rest ends before recovery → null +
  `recovered_*=false`); **sparse coverage** → all-null + `coverage_ok=false`; **missing RHR/HRmax** →
  RHR-dependent metrics null gracefully; boundary at set-window edges.
- **DB-backed test** (mirror `oura-ble-aggregate.test.ts`) against local Postgres for the upsert +
  `getSetHrStatsForExercise` trend query (COALESCE fuller-wins; user-scoping).
- **`pnpm dev`** exercise: complete a workout with seeded HR readings, hit the recap → per-set stats
  persist; open the exercise-history card → trend renders; backfill route populates an old session.
- **Device gate (Canonical Runtime):** the live workout HR capture + the card's safe-area/rendering are
  APK-only — either run `docs/device-smoke-checklist.md` or add a `projectOverview.md` Known-Issues row
  marking the card web-verified-only. The *capture/persist* logic (PR A) is fully sandbox-testable.

## 6. Docs / bookkeeping (in the implementer PRs)

- Add a `docs/module-map.md` row: `lib/workout/set-hr-stats.ts` — the single per-set HR metric formula
  (peak/avg/drop-curve/three recovery models); and note `set_hr_stats` (mig 139) as the durable per-set
  snapshot, sibling of `workout_hr_stats`.
- Journal entry (new file in `docs/overview/entries/`) + `projectOverview.md` index update + version/
  changelog bump (minor — new user-visible feature) in the surfacing PR (B).
- Confirm `set_hr_stats` is **excluded from any sync delta / offline domain** (server-derived only), and
  is **not** added to the 180 d prune.

## 7. Risks / watch-items

- **Mixed-fidelity peaks:** pre-per-set-timing sessions use the `logged_at±window` proxy; true-window
  sessions use `setStart→setEnd`. Trends mix the two — acceptable, but note it (peaks on old sessions
  may read slightly differently).
- **RHR reliability:** `sec_to_resting` / `%HRR` depend on a trustworthy daily RHR; when missing, those
  two definitions null out — which is exactly why we capture the pre-set-baseline definition too.
- **Capture urgency:** every day PR A is not shipped, another day of workouts ages toward the 180 d prune
  with only the coarse per-session snapshot retained. Ship PR A before PR B.
- **No CNS claim:** the rest-sufficiency flag is cardiovascular-only; the label is load-bearing, not
  decorative.
