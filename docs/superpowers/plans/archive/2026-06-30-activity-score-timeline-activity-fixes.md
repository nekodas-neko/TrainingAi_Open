# Activity Score + Timeline + Activity-Tracking Fixes — Implementation Plan

**Date:** 2026-06-30
**Branch:** `claude/activity-score-timeline-updates-waj7nw` (single bug-fix/feature branch, batched)
**Status:** IMPLEMENTED — all six items built and verified against the local dev DB (tsc clean, lint clean, 264 unit tests pass incl. 7 new blend tests; activity blend, meal times, yesterday timeline, and periodization SQL all runtime-checked).

Six independent changes requested in one session, to be implemented together on one
branch and shipped as a single PR. Decisions already taken with the user:

| # | Area | Decision |
|---|------|----------|
| 1 | Activity score | **Blend** logged gym training load *into* the displayed Activity score (mirror the existing ACWR→Readiness blend). |
| 2 | Timeline nutrition times | Use the **exact `loggedAt`** when food was logged inside its window; otherwise fall back to the **window END** (latest), not the window start. |
| 3 | Timeline — yesterday | Show **yesterday's events except meals** (workouts, walks, sleep "fell asleep"+latency, "woke up"). |
| 4 | AI Periodization count | Fix the stale per-session count after a workout is **deleted** (decrement counter + invalidate cache). |
| 5a | Auto-detect false positives | **Balanced** thresholds: ≥750 m, ≥2.5 km/h avg, ≥7 min. |
| 5b | Steps | Write Oura `daily_activity.steps` into `body_metrics.steps` (currently never written). |
| 5c | "Workout detected" card | Move the Review/Dismiss card from the **Health** tab to the **Home** screen. |

No new DB migration is required (every column used — `body_metrics.steps`,
`session_periodization.sessions_in_phase`, `sleep_sessions.onset_latency_sec`,
`food_logs.logged_at` — already exists).

---

## 1. Blend gym training load into the Activity score

### Problem
The Activity score is Oura's `daily_activity.score` passed straight through — never
adjusted. Oura derives its `training_volume` / `training_frequency` contributors from
movement/HR, so resistance training is badly under-counted (screenshot: Legs day →
`training_volume` 46, Activity 62). The user wants logged gym work to lift the score.

### Where it surfaces (single source)
Both readers pull `activityScore` + `activityContributors` from **`/api/readiness-score`**:
- Home chip — `components/oura-score-chip-row.tsx:69` (`readiness.activityScore`)
- Activity detail page — `app/health/activity/activity-content.tsx:101` (`cachedFetch<ReadinessScoreResponse>("readiness-score", ...)`)

`app/api/readiness-score/route.ts` already loads `recentSessions` with per-exercise
`volume` for the ACWR calc (lines ~145–175) and emits `activityScore`/`activityContributors`
(line ~227). So the blend has exactly one implementation site and the input data is
already in scope.

### Approach — new pure helper, applied in `readiness-score`
Create `lib/activity/blend-activity.ts` (pure, unit-testable, mirrors
`computeBlendedScore` in the readiness route):

```ts
export interface ActivityBlendInput {
  ouraActivityScore: number | null   // Oura daily_activity.score
  trainingVolumeContrib: number | null // Oura contributors.training_volume (0–100)
  todayWorkoutVolumeKg: number        // sum of logged set tonnage for the day (0 if none)
  typicalSessionVolumeKg: number      // user's median logged session volume (baseline)
}
export interface ActivityBlendResult {
  base: number | null      // Oura score, unchanged
  adjustment: number       // points added (0 when no gym session today)
  final: number | null     // clamp(base + adjustment, 0, 100)
  trained: boolean         // a gym session was logged today
}
```

Formula (constants at top of file, **flagged tunable**):

```
TRAIN_CREDIT_BASE = 6     // points for having trained at all today
TRAIN_CREDIT_VOL  = 8     // extra points scaled by volume vs. the user's typical session
MAX_ADJ           = 14    // hard cap on the bump

if todayWorkoutVolumeKg <= 0:           adjustment = 0            // no logged session → pure Oura
else:
  volRatio = clamp(todayWorkoutVolumeKg / max(typicalSessionVolumeKg, 1), 0, 1.5)
  raw      = TRAIN_CREDIT_BASE + TRAIN_CREDIT_VOL * min(volRatio, 1)
  # only credit what Oura missed — if Oura already scored training high, add little
  missed   = 1 - clamp((trainingVolumeContrib ?? 0) / 100, 0, 1)
  adjustment = round(clamp(raw * missed, 0, MAX_ADJ))
final = base == null ? null : clamp(base + adjustment, 0, 100)
```

Rationale: a big leg day with a low Oura `training_volume` gets the full bump; a day Oura
already scored as high-volume gets almost none (no double counting); a rest day is
untouched.

### Wiring
- In `readiness-score/route.ts`: compute `todayWorkoutVolumeKg` from the already-loaded
  sessions filtered to today; compute `typicalSessionVolumeKg` (median of the recent
  sessions' total volume — reuse the ACWR session list). Call the helper, then return the
  **blended** `activityScore` plus a new `activityBlend: ActivityBlendResult` object so the
  UI can show the breakdown.
- Extend `ReadinessScoreResponse` with `activityBlend`.

### UI
- **Home chip** (`oura-score-chip-row.tsx`): show `activityBlend.final` (falls back to raw
  when `trained` is false). Add a tiny "+N" superscript or a subtle dumbbell dot when
  `adjustment > 0` so it's clear the number includes training.
- **Activity detail page** (`activity-content.tsx`): under the score arc, render a small
  breakdown line when `adjustment > 0`: `Oura {base} · +{adjustment} training → {final}`
  (mirror the readiness-card "Oura base → ACWR adj → final" pattern). Keep Oura's six
  contributor bars unchanged below it.

### Tests
`lib/activity/blend-activity.test.ts`: no session → adjustment 0 / score unchanged;
high-volume leg day with low Oura training_volume → near-max bump; day Oura already scored
high → near-zero bump; null Oura score → null final; cap respected.

---

## 2. Nutrition timeline — exact log time, else window end

### Current behaviour
`app/api/day-timeline/route.ts` meal block (lines 114–138) stamps every meal event at the
**window start** (`windowStart` / `timeStartHour`). `food_logs.loggedAt` (a full timestamp)
is already returned by `repo.listFoodLogs` but unused for positioning.

### Change (meal block only)
For each meal group:
1. Compute `windowStart` and `windowEnd` as Dates (windowEnd already constructed for the
   label — reuse it).
2. Collect the group's `loggedAt` timestamps. Let `inWindow` = those with
   `windowStart ≤ loggedAt ≤ windowEnd`.
3. **Event time:**
   - If `inWindow` non-empty → use the **latest** `loggedAt` in window (the most recent
     item logged within the window — consistent with the "choose latest" preference).
   - Else → use **`windowEnd`** (latest time of the window) instead of `windowStart`.
4. Set both `time` (formatted) and `timeMs` from that chosen instant. Keep the
   `windowLabel` subtitle (`6:00 AM – 10:00 AM`) exactly as-is.

Edge cases: a meal logged before its window opens or after it closes (e.g. a late dinner
logged at 11pm) falls back to window end — it still sorts sensibly and never collapses to
the early window start. Backfilled meals with `loggedAt` far from the window still land at
the window end, preserving the original "backfill lands correctly" intent noted in the code
comment.

No schema or repository change — `loggedAt` is already in the payload.

---

## 3. Timeline — add yesterday's events (everything except meals)

### Current behaviour
The route queries a single `date` (today). Sleep onset latency (`onset_latency_sec`) and
sleep-start time exist on `sleep_sessions` but are never surfaced.

### Change
Extend the route to additionally build **yesterday's** workout, walk, and sleep events
(no meals), then merge them into the same `events` array. The UI groups by day via a
"Yesterday" divider.

Concretely:
- Compute `yesterday = date - 1 day` (tz-aware, via date-utils).
- Fetch yesterday's data alongside today's (extend the existing `Promise.all`):
  `listSleepSessions(userId, yesterday, yesterday)`, reuse the already-wide
  `getWorkoutSessionsFrom` window (extend its lower bound to cover yesterday), and the Oura
  walks list already returns multiple days — filter `w.day === yesterday` too.
- **Yesterday workouts / walks:** same builders as today, just the yesterday day-window.
- **Yesterday "Woke up":** same primary-night selection logic as today, applied to
  yesterday's sleep rows → `sleepEnd`, with duration + readiness/sleep scores.
- **"Fell asleep" event (new type `'sleep'` or reuse `'bedtime'`):** from **today's**
  primary sleep session's `sleepStart` (this is yesterday-evening wall-clock, matching the
  Oura screenshot where "Fell asleep 10:21 PM" sits under the Yesterday header). Subtitle:
  `{onsetLatencySec/60} min latency` when `onsetLatencySec` is present. Icon: `Moon`/`Bed`.
- Add an event field `day: 'today' | 'yesterday'` (or compare `timeMs` against today's
  `dayStart`) so the UI can insert the divider. Keep the global
  `events.sort((a,b) => b.timeMs - a.timeMs)` — chronological newest-first naturally places
  the Yesterday group below today.

### UI (`components/home-day-timeline.tsx` + `app/health/timeline/page.tsx`)
- Add a `FellAsleepCard` (title "Fell asleep", time, "{n} min latency" subtitle).
- Render a "Yesterday" section divider before the first event whose `day === 'yesterday'`
  (or whose `timeMs < todayDayStart`).
- The existing `WakeupCard`/`WorkoutCard`/`WalkCard` are reused unchanged for yesterday's
  rows. Meals are intentionally excluded for yesterday (only built for `date`).

### Notes / decisions
- "Fell asleep" semantics: use `sleepStart` as the marker and `onset_latency_sec` for the
  latency label. (Oura's "fell asleep" ≈ onset; `sleepStart` is close enough and is what we
  store — flagged as a minor approximation, tune later if needed.)
- Yesterday meals are excluded per the user's "everything except meals".

---

## 4. AI Periodization — stale per-session count after delete

### Root cause (two-fold)
`session_periodization.sessions_in_phase` is a **stored counter**, `+1` on workout-complete
(`app/api/complete-workout/route.ts:40` → `incrementSessionsInPhase`), but:
1. The delete path (`app/api/workout-entry/route.ts` DELETE, ~lines 73–128) **never
   decrements** it.
2. The delete path **invalidates no caches**, and the card caches the overview for 30 min
   (`components/health/ai-periodization-status-card.tsx:48–51`, key
   `ai-periodization-overview`).

So "Upper · 3 sessions" stays 3 after a delete even on hard refresh, because the DB counter
itself is stale.

### Fix
**Server (`lib/data/postgres/slices/periodization.ts`):** add
`decrementSessionsInPhase(programId, sessionId)` — `sessions_in_phase = GREATEST(sessions_in_phase - 1, 0)`
for the matching session-periodization row.

**Delete route (`app/api/workout-entry/route.ts` DELETE):** when the delete removes a
workout session that counted toward the current phase, call `decrementSessionsInPhase`.
Guard for correctness: only decrement when the deleted `workout_session.startedAt >=
phaseStartedAt` for that session type (so deleting an old session from a previous phase
doesn't wrongly decrement the current phase). Resolve the session-periodization row by the
deleted session's program + session identity.

**Cache (client):** `cachedFetch` is client-side localStorage, so the API can't clear it —
the component that triggers the delete must invalidate after a successful DELETE. Find the
delete trigger (workout history / entry edit UI) and call `invalidateWorkoutSummaries()`
(`lib/cache-groups.ts`, which already includes `ai-periodization-overview` at line 23) on
success, then refetch. This also fixes the timeline/HR/training-count staleness after a
delete generally.

### Tests
Unit-test the decrement floor (never below 0) and the phase-window guard in the periodization
slice (against the local dev DB, as existing periodization tests do).

---

## 5a. Auto-detect false positives — Balanced thresholds

### Current
- Oura server route `app/api/oura/workouts/route.ts:11–13`: `MIN_DISTANCE_M=500`,
  `MIN_AVG_SPEED_KMH=1.5`, `MAX_DURATION_SEC=3h`. 1.5 km/h passes a slow pottering stroll.
- Day-timeline route has its own copy of the same three constants (`route.ts:34–36`).
- Phone GPS path `lib/stores/auto-detection-store.ts:38–127`: only **upper** bounds
  (`MAX_SPEED_MS=7.5`, `MOTORISED_P80_SPEED_MS=8.0`) and `MIN_DURATION_MS=5min` — **no lower
  distance/speed bound**, so a slow short shuffle qualifies.

### Change — apply Balanced everywhere
New shared thresholds (factor into one module, e.g. `lib/activity/detection-thresholds.ts`,
imported by all three sites so they can't drift):
```
MIN_DISTANCE_M    = 750
MIN_AVG_SPEED_KMH = 2.5     // = 0.694 m/s
MIN_DURATION_SEC  = 7 * 60  // 420 s
MAX_DURATION_SEC  = 3 * 3600 (unchanged)
```
- Oura workouts route: raise distance/speed, add the 7-min minimum-duration gate.
- Day-timeline walk filter: same (replace its local copy with the shared module).
- Phone GPS store: add lower bounds — reject if `distanceKm*1000 < MIN_DISTANCE_M`,
  `avgSpeedMs < 0.694`, or `durationMin < 7`; keep the existing motorised/driving rejections.

Detection stays **manual-review only** (cards still require Review/Dismiss — unchanged); the
thresholds just stop the pottering cards from ever being created.

---

## 5b. Steps — sync Oura `daily_activity.steps` into `body_metrics.steps`

### Current
`app/api/oura/sync/route.ts` writes `daily_activity` into `oura_daily` (score, calories,
times) but **never writes `steps`**; the body-metrics back-fill block (lines ~236–280) only
sets `active_calories`, `hrv_ms`, `resting_heart_rate`, `spo2_pct`. The UI reads steps from
`body_metrics.steps` (`/api/body-metadata`, shown on home week overlay
`session-select-content.tsx:1459` and metric tiles), so synced steps never appear.

### Change
In the Oura sync body-metrics back-fill, include `steps` from each day's `daily_activity`
response, following the existing `COALESCE(EXCLUDED.col, table.col)` upsert pattern
(EXCLUDED wins when non-null) so Oura populates steps without clobbering a manually-entered
value with NULL. Add `steps` to whichever repository upsert the back-fill calls (the
`active_calories` path is the template). Verify the steps goal/metric tiles render the
populated value after a sync against the local dev DB.

---

## 5c. Move the "Workout detected" card to Home

### Current
`components/activity/exercise-detected-card.tsx` renders inside the Health → Training tab
(`app/health/health-sections.tsx:819–824`, `activityHistory` case). It reads the
`auto-detection-store` (Zustand) for pending sessions, pulls unreviewed Oura workouts, and
its `onReview(id)` opens a review flow.

### Change
- Remove `<ExerciseDetectedCard>` from `health-sections.tsx` (the rest of the
  activity-history section stays on Health).
- Render it on the Home screen `app/session-select/session-select-content.tsx` as a new
  section, positioned near the top (after the recommendation card, before streak/week
  strip). Add it to `buildDefaultOrder()` (~line 206), the hidden-sections handling, and the
  section render switch.
- **Move the review flow with it.** The card's `onReview` currently opens a review sheet on
  the Health tab — replicate that handler on Home (mount the same review sheet/component, or
  navigate to the existing review route) so Review still works from Home. Confirm the
  Zustand store + Oura-sync throttle are screen-agnostic (they are — store is global), so no
  state duplication.
- The card auto-hides when there are no pending sessions (existing behaviour), so it won't
  add clutter on normal days.

---

## Build order & testing

Suggested order (low-risk → design-heavy): **5b steps → 4 periodization → 2 meal times →
5a thresholds → 5c card move → 3 yesterday → 1 activity blend.**

Per CLAUDE.md, **everything is tested on `pnpm dev` against the local dev DB before the merge
ask**:
- **1 Activity blend:** log a workout for "today" in the dev DB, hit `/api/readiness-score`,
  confirm `activityScore` rises by the expected bump and `activityBlend` breakdown is
  present; rest day → unchanged. Helper unit tests green.
- **2 Meal times:** log food inside and outside a meal window; confirm the timeline event
  shows the exact in-window time, and the out-of-window case falls back to window end.
- **3 Yesterday:** seed yesterday sleep (with `onset_latency_sec`) + a yesterday workout;
  confirm "Yesterday" divider, "Fell asleep … min latency", and yesterday "Woke up" render;
  no yesterday meals appear.
- **4 Periodization:** complete a session (count goes up), delete it, confirm the count
  drops and the card refreshes (cache cleared); old-phase delete doesn't wrongly decrement.
- **5a Thresholds:** feed a 600 m / 1.8 km/h Oura "walk" → no card; a 1 km / 4 km/h walk →
  card appears.
- **5b Steps:** run an Oura sync against dev DB → `body_metrics.steps` populated → home/metric
  tiles show the count.
- **5c Card move:** detected card renders on Home, Review opens the flow, gone from Health.

Then run lint + type-check + the unit suites, push the branch, open one PR, let CI go green.
This batch is a mix of **bug fixes for shipped features** (2, 4, 5a, 5b, 5c) and one
**new-behaviour feature** (1 activity blend) + a timeline extension (3). The activity-blend
formula constants are tunable and flagged; surface the merge-confirmation gate for the
deploy since it changes a user-facing score.

## Risk notes
- Activity blend changes a visible number — keep the adjustment bounded (`MAX_ADJ=14`) and
  show the breakdown so it's explainable; constants live in one helper for easy tuning.
- Periodization decrement must be phase-window-guarded to avoid under-counting when deleting
  historical sessions.
- Detection thresholds are centralised so the three copies can't drift again.
- Steps upsert must not overwrite a manual value with NULL (COALESCE-EXCLUDED pattern).
