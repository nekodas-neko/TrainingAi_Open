# Health > Progress Tab Redesign — Design Spec

**Date:** 2026-06-15
**Status:** Approved, ready for implementation plan

## Overview

Redesign the Health > Progress tab from its current shape (a strength card,
a weight sparkline, and a single weight-only goal bar) into three focused
cards:

1. **Estimated 1RM** — existing per-exercise PR-comparison bars (shipped
   v1.39.1), now with a toggle between "Latest vs PR" and "Working Set vs PR"
   (the latter using a reps-based comparison for bodyweight exercises).
2. **Goals** — Steps, Calories, Water, Sleep, and Workouts, all normalized to
   a single Today/This Week toggle, framed as "life admin" bars the user can
   fill to 100% every day.
3. **Long-Term Goals** — direction-aware Weight/Body Fat progress from a
   starting baseline toward the user's target, alongside the existing weight
   sparkline.

## Goals

- Give every configured goal (steps, calories, water, sleep, workouts,
  weight, body fat) a visible progress bar on this one tab.
- Make `sleepGoalHours` and workout-schedule compliance comparable to the
  other daily goals — today neither is surfaced as a "goal" anywhere.
- Let the user pick, per exercise, whether the 1RM bar means "how close is my
  current estimate to my best ever" (Mode A, existing) or "how heavy/many
  reps am I working with right now relative to my best ever" (Mode B, new).
- Replace the single symmetric weight-goal bar with direction-aware
  progress that works for both gaining and losing goals.

## Out of Scope

- New migrations — `listMaxReps` and `getBodyMetricsBaseline` are computed
  via live queries against existing tables.
- Editing goal values from this tab — remains Profile-only
  (`goal-targets-section.tsx`); Progress tab is read-only.
- Historical trend charts for steps/calories/water/sleep — only "today vs
  goal" / "this week vs goal" snapshots.
- Changing how `estimated1rm` / `personalRecord1rm` are computed or
  ratcheted — Card 1 only changes what's compared against what.
- Re-anchoring the "starting point" baseline when the user edits their
  target weight/BF — `getBodyMetricsBaseline` always returns the
  earliest-ever logged value (see Edge Cases).

---

## 1. Card 1 — Estimated 1RM (Mode Toggle)

Rewrite `components/health/strength-progress-card.tsx`. Add a Mode toggle at
the top of the card, using the existing segmented-pill pattern from
`goal-targets-section.tsx` (`bg-muted p-0.5` pill, active = `bg-background
shadow-sm text-foreground`):

- **Mode A — "Latest"** (existing behaviour, shipped v1.39.1, default)
- **Mode B — "Working Set"**

Toggle state is local `useState` (default Mode A) — not persisted.

### 1.1 Mode A — Latest vs PR (unchanged)

```ts
const pr = ex.personalRecord1rm ?? ex.estimated1rm ?? 0
const pct = pr > 0 ? Math.min((ex.estimated1rm ?? 0) / pr * 100, 100) : 100
// gold (#fbbf24) if pct >= 99.5, else purple (#bf5fff)
// label: `${ex.estimated1rm} kg`
```

### 1.2 Mode B — Working Set vs PR (weighted exercises)

For `exerciseType !== 'bodyweight'`:

```ts
const pr = ex.personalRecord1rm ?? 0
const pct = pr > 0 ? Math.min((ex.weight ?? 0) / pr * 100, 100) : 100
// label: `${ex.weight} kg`
```

`ex.weight` is the existing "last working weight" field (`sets[0].weightKg`
of the most recent logged set). Skip the row in Mode B if `ex.weight == null`
(no logged sets yet) — Mode A may still show it.

### 1.3 Mode B — Reps vs Max Reps (bodyweight exercises)

For `exerciseType === 'bodyweight'`:

```ts
const max = ex.maxReps ?? 0
const pct = max > 0 ? Math.min((ex.lastReps ?? 0) / max * 100, 100) : 100
// label: `${ex.lastReps} reps`
```

Skip the row in Mode B if `ex.lastReps == null` or `ex.maxReps == null`.

Gold/purple thresholds (`pct >= 99.5`) and the per-session grouping/headers
are unchanged across both modes.

### 1.4 Data — extend `app/api/weights-summary/route.ts`

```ts
export interface ExerciseSummary {
  exercise: string;
  weight: number | null;
  date: string | null;
  sessionName: string;
  estimated1rm: number | null;
  target80: number | null;
  personalRecord1rm: number | null;
  exerciseType: 'weighted' | 'bodyweight';  // NEW
  lastReps: number | null;                  // NEW — sets[0].reps of latest log
  maxReps: number | null;                   // NEW — all-time max reps logged
}
```

Populate via:

- `exerciseType` — from `repo.listExerciseLibrary()`, mapped by exercise
  name; default `'weighted'` for any exercise not found in the library
  (matches the schema column's default).
- `lastReps` — `log?.sets[0]?.reps ?? null` (same `log` already used for
  `weight`/`estimated1rm`/`target80`).
- `maxReps` — from new `repo.listMaxReps(userId)` (§4.1), a
  `Map<exerciseName, number>`. Populated for all exercises (one cheap query);
  the UI only consumes it for `exerciseType === 'bodyweight'`.

---

## 2. Card 2 — Goals

New component `components/health/goals-progress-card.tsx`.

Header: "Goals" title (same `text-xs font-semibold uppercase tracking-widest
text-muted-foreground` style as Card 1) + a Today/This Week segmented toggle
(local `useState`, default "Today") that normalizes **every** row below.

| Row | Icon | Color | "Today" value | "This Week" value | Goal source |
|---|---|---|---|---|---|
| Steps | `Footprints` | `#22c55e` | `metaToday.steps` | `weekToDate.steps` | `stepsGoal` / `stepsGoalType` |
| Calories | `Flame` | `#f97316` | `metaToday.calories` | `weekToDate.calories` | `calorieGoal` / `calorieGoalType` |
| Water | `Droplet` | `#38bdf8` | `metaToday.waterMl` | `weekToDate.waterMl` | `waterGoalMl` / `waterGoalType` |
| Sleep | `Moon` | `#a78bfa` | `sleep.lastNightHours` | `sleep.thisWeekHours` | `sleepGoalHours` (always daily) |
| Workouts | `Dumbbell` | `#fbbf24` | `workouts.todayComplete ? 1 : 0` | `workouts.completedThisWeek` | `1` (today) / `workouts.scheduledThisWeek` |

Each row renders the extracted `GoalProgressBar` (§4.5) and is hidden
entirely if its goal resolves to `null`/`<= 0` (existing `GoalProgressBar`
behaviour — no extra logic needed). If **every** row is hidden (no goals
configured, no active program), the whole card renders nothing, mirroring
`StrengthProgressCard`'s empty state.

### 2.1 Normalizing Steps / Calories / Water

```ts
function normalizeGoal(goal: number, goalType: 'daily' | 'weekly', view: 'today' | 'week'): number {
  if (goalType === 'daily') return view === 'today' ? goal : goal * 7
  return view === 'today' ? goal / 7 : goal
}
```

The value side needs no normalization — `/api/body-metadata` already returns
both `today` and `weekToDate` for steps/calories/water.

### 2.2 Sleep row

`sleepGoalHours` is always a daily figure:

```ts
goal  = view === 'today' ? sleepGoalHours : sleepGoalHours * 7
value = view === 'today' ? sleep.lastNightHours : sleep.thisWeekHours
```

`lastNightHours` is the duration of the **most recently completed sleep
session** (by `date`, descending) — regardless of whether `date === today` —
so the bar reflects "the night that just passed" and is fillable as soon as
the user wakes up. `thisWeekHours` sums `durationHours` for sessions where
`date >= startOfWeekInTz(tz)`.

### 2.3 Workouts row

```ts
goal  = view === 'today' ? 1 : workouts.scheduledThisWeek
value = view === 'today' ? (workouts.todayComplete ? 1 : 0) : workouts.completedThisWeek
```

- `todayComplete` is `true` if the user has already logged a session today
  **or** today is a scheduled rest day (per `getNextSession`'s `isRestDay`).
  It's `false` (0/1, "pending") only when a session is due and not yet done.
- `completedThisWeek` counts unique `(date, sessionName)` training days since
  Monday with at least one logged exercise — same definition as
  `weekly-stats`'s `totalSessions`.
- `scheduledThisWeek` comes from the new `getScheduledSessionsPerWeek(program)`
  helper (§4.2).

---

## 3. Card 3 — Long-Term Goals (Weight / Body Fat)

Replaces the existing "Goal Progress" block
(`app/health/health-content.tsx:1004-1025`) and keeps the existing Weight
Trend sparkline (`health-content.tsx:996-1003`) at the top of the same card.

Rows (each shown only if all three values are non-null):

- **Weight** — `latestWeight` (existing client derivation, `health-content.tsx:392`),
  `bodyBaseline.weightKg` (new, §4.1), `targetWeightKg` (existing `UserGoals`).
- **Body Fat** — `latestBf` (`health-content.tsx:395`), `bodyBaseline.bodyFatPct`,
  `targetBfPct`.

### 3.1 Direction-aware progress

```ts
function goalProgressPct(starting: number, current: number, target: number): number {
  if (starting === target) return 100
  const pct = (current - starting) / (target - starting) * 100
  return Math.max(0, Math.min(100, pct))
}
```

Works for both decreasing goals (`target < starting`, e.g. lose
weight/fat) and increasing goals (`target > starting`): movement toward
`target` increases `pct`; movement away clamps to `0` rather than going
negative.

### 3.2 UI

Each row: label, `current → target` text (e.g. "82.4 → 78.0 kg"), and a
progress bar using the existing bar markup/styling from
`health-content.tsx:1013-1021`. Colors: Weight = `var(--color-brand)`
(unchanged), Body Fat = `#2dd4bf`.

---

## 4. Data Layer

### 4.1 Repository additions (`lib/data/repository.ts` + `postgres/adapter.ts`)

```ts
// All-time max reps logged per exercise — used for bodyweight Mode B.
listMaxReps(userId: string): Promise<Map<string, number>>

// Earliest-ever logged weight/body-fat values — "starting point" for Card 3.
getBodyMetricsBaseline(userId: string): Promise<{ weightKg: number | null; bodyFatPct: number | null }>
```

`listMaxReps`:

```sql
SELECT el.exercise_name, MAX(sl.reps) AS max_reps
FROM set_logs sl
JOIN exercise_logs el ON el.id = sl.exercise_log_id
JOIN workout_sessions ws ON ws.id = el.workout_session_id
WHERE ws.user_id = $1
GROUP BY el.exercise_name
```

`getBodyMetricsBaseline` — earliest non-null row per column, e.g.:

```sql
SELECT weight_kg FROM body_metrics
WHERE user_id = $1 AND weight_kg IS NOT NULL
ORDER BY date ASC LIMIT 1

SELECT body_fat_pct FROM body_metrics
WHERE user_id = $1 AND body_fat_pct IS NOT NULL
ORDER BY date ASC LIMIT 1
```

### 4.2 New pure helper — `lib/schedule-utils.ts`

```ts
export function getScheduledSessionsPerWeek(program: Program): number {
  const schedule = program.schedule
  if (schedule?.type === 'weekly') {
    return (schedule.days ?? []).filter(d => d.sessionId).length
  }
  if (schedule?.type === 'rotation') {
    const cycleLen = program.sessions.length + (schedule.restAfterN ?? 0)
    return cycleLen > 0
      ? Math.max(1, Math.round(program.sessions.length / cycleLen * 7))
      : program.sessions.length
  }
  return program.sessions.length
}
```

### 4.3 New API route — `app/api/progress-summary/route.ts`

`GET`, auth required.

```ts
{
  sleep: { lastNightHours: number | null; thisWeekHours: number }
  workouts: { todayComplete: boolean; completedThisWeek: number; scheduledThisWeek: number }
  bodyBaseline: { weightKg: number | null; bodyFatPct: number | null }
}
```

Implementation:

1. `tz = session.user.timezone ?? DEFAULT_TZ`, `today = todayInTz(tz)`,
   `weekStart = startOfWeekInTz(tz)`.
2. **sleep** — `repo.listSleepSessions(userId, sevenDaysAgo, today)`, sort by
   `date` desc; `lastNightHours = sessions[0]?.durationHours ?? null`;
   `thisWeekHours = sum(durationHours where date >= weekStart)`.
3. **workouts** —
   - `program = await repo.getActiveProgram(userId)`
   - `trainedToday = (await repo.getDayExerciseNames(userId, today)).length > 0`
   - `next = await repo.getNextSession(userId, tz)`
   - `todayComplete = trainedToday || next.isRestDay`
   - `sessions = await repo.getWorkoutSessionsFrom(userId, mondayUtc)` filtered
     to `exercises.length > 0`; `completedThisWeek` = count of unique
     `(date, sessionName)` pairs (mirrors `weekly-stats`'s `totalSessions`).
   - `scheduledThisWeek = program ? getScheduledSessionsPerWeek(program) : 0`
4. **bodyBaseline** — `repo.getBodyMetricsBaseline(userId)`.

Cache headers: `private, max-age=60, stale-while-revalidate=120` (matches
`weekly-stats`).

### 4.4 Client fetches in `app/health/health-content.tsx`

- `cachedFetch('progress-summary', '/api/progress-summary', TTL_MEDIUM, ...)`
- `cachedFetch('user-goals', '/api/user/goals', TTL_MEDIUM, ...)` — provides
  `stepsGoal`/`calorieGoal`/`waterGoalMl`/`*GoalType`/`sleepGoalHours`/
  `targetWeightKg`/`targetBfPct` for Cards 2 & 3.

### 4.5 Shared component extraction

Extract `GoalProgressBar` from `components/profile/goal-targets-section.tsx`
into `components/health/goal-progress-bar.tsx` (exported, same signature),
imported by both `goal-targets-section.tsx` and the new
`goals-progress-card.tsx`.

---

## 5. Cache Invalidation (`lib/cache-groups.ts`)

- `invalidateWorkoutSummaries()` — add `'progress-summary'` (a completed
  workout changes the Workouts row and Card 1's `lastReps`/`maxReps`/`weight`
  via `'weights-summary'`, already invalidated).
- `invalidateReadinessInputs()` — add `'progress-summary'` (sleep/mood/body
  writes change the Sleep row).
- `invalidateGoalRecommendations()` — add `'progress-summary'` and
  `'user-goals'` (applying a recommendation, or editing goals/targets in
  Profile, changes goals across Cards 2 & 3).

---

## 6. Edge Cases & Safety

- **No active program** — Card 2's Workouts row hidden
  (`scheduledThisWeek === 0` → `GoalProgressBar` hides on `goal <= 0`); Card 1
  unchanged (already hides entirely when `weights-summary` returns no
  exercises).
- **Sleep never logged** — `lastNightHours == null` hides the "Today" sleep
  row (existing `GoalProgressBar` `value == null` behaviour); `thisWeekHours`
  defaults to `0`, so "This Week" still renders at 0% if `sleepGoalHours` is
  set. No special-casing needed.
- **Mode B exceeding 100%** — `personalRecord1rm`/`maxReps` are ratcheting
  all-time bests, so `weight <= personalRecord1rm` and `lastReps <= maxReps`
  hold in the normal case; the `Math.min(..., 100)` cap guards any edge-case
  staleness regardless.
- **Bodyweight exercise never logged** — `lastReps == null` or
  `maxReps == null` → row skipped in Mode B (same treatment as a weighted
  exercise with no `weight`).
- **Baseline drift** — `getBodyMetricsBaseline` always returns the
  earliest-ever logged value, even if the user sets a *new* target months
  later. Per the approved "progress from starting point" semantic, this is
  accepted: a new target may show >0% progress immediately. Not treated as a
  defect.
- **Rotation schedules with `restAfterN >= sessions.length`** —
  `getScheduledSessionsPerWeek`'s `Math.max(1, ...)` floor guarantees
  `scheduledThisWeek >= 1` for any active program, so the Workouts row is
  never hidden by a `goal <= 0`.
