# Workout Flow Rework — Design Spec
_2026-05-27_

## Goal

Rework the exercise flow into one continuous session: timer starts on "Start Workout" and is visible across every screen until done. Add full workout state persistence via Zustand so a page reload mid-session (e.g. Railway redeploy, Android WebView eviction) does not lose timing data or progress. Improve data capture granularity so set times, rest times, and inter-exercise rest can be correlated with Health Connect heart rate data.

---

## Scope

### In this branch
1. Exercise pill → read-only stats sheet (no solo launch)
2. Warmup weights on the per-exercise ready screen (within the active workout flow)
3. Session timer visible across all active screens
4. Zustand store + localStorage persist replacing scattered `useState`/`useRef` in `workout-screen.tsx`
5. Improved data capture: `setStartMs`, `setEndMs`, `restBeforeMs` per set; `interExerciseRestMs` between exercises

### Explicitly out of scope
- Active set card UI redesign (hero card, +/− steppers)
- Exercise summary UI redesign
- Starting animation before warmup screen

---

## Screen Flow

```
Pre-workout list  ──[Start Workout]──►  Warmup screen  ──[Begin Exercises]──►
  Exercise ready  ──[Begin Exercise]──►  Active sets  ──[Log last set]──►
  Exercise summary  ──[Next Exercise]──►  (back to Exercise ready for idx+1)
  ...after last exercise...  ──►  Done screen
```

Timer starts when "Start Workout" is pressed (`workoutStartMs`). It is displayed in the persistent session header on every screen from warmup onwards.

Tapping an exercise pill on the pre-workout list now opens a stats sheet — it no longer starts a solo workout.

---

## 1. Exercise Pill → Stats Sheet

### Trigger
Tap any exercise pill on the pre-workout screen.

### Sheet contents
- Exercise name (large heading)
- Last performance: date · weight × reps per set
- **1RM rep targets table** — given the exercise's working weight (from progression style set 3/4 at 80%, or `target80` fallback), calculate reps needed to:
  - Fall below current 1RM (e.g. 7 reps → 110 kg)
  - Match current 1RM (e.g. 8 reps → 115 kg)
  - Exceed current 1RM (e.g. 9 reps → 120.3 kg)
  - Formula: `est1rm = weight × (1 + reps / 30)` (Epley). Solve: `reps = (target1rm / weight − 1) × 30`.
- 1RM trendline (fetch `/api/exercise-history?exercise=NAME`, last 8 sessions — same fetch already used in `ActiveWorkoutScreen`)
- Muscle map (`MuscleHeatmap` with `mainMuscles` + `secondaryMuscles`)

### Re-do button
If the exercise name is in `todayLogged`, show a "Re-do" button at the bottom of the sheet. Pressing it launches the exercise in solo mode (same behaviour as the old pill tap). This still logs a full set entry.

### Removed
`onLaunchExercise` is no longer called from a pill tap in normal (non-re-do) mode. The `soloMode` path remains for re-do only.

---

## 2. Warmup Weights on the Ready Screen

The per-exercise ready screen (shown after pressing "Begin Exercises" from warmup, or "Next Exercise" from summary) already shows: exercise name, last performance, set targets card, 1RM trendline.

**Add:** warmup weight strip (50% / 60% / 70% of `estimated1rm`) between the set targets card and the trendline. Only rendered when `estimated1rm` is set and the workout is in the start-workout flow (not when re-opening a solo log from a re-do).

The active-set screen currently renders this strip when `timerStarted=true`. Remove it from there — it belongs on the ready screen where the user is preparing.

---

## 3. Session Timer in Header

`workout-screen.tsx` already computes elapsed session time via `workoutStartRef`. Currently it is only shown inside `ActiveWorkoutScreen`'s header.

**Change:** pass `workoutStartMs: number | null` as a prop to every child screen. Each screen's header renders a live `MM:SS` timer derived from `workoutStartMs` when it is non-null. The interval (`setInterval` 1 s) lives in the orchestrator and produces a `sessionElapsedSec: number` state value that is passed down, avoiding N timers.

Screens that receive the timer prop: `WarmupScreen`, `ActiveWorkoutScreen`, `ExerciseSummaryScreen`, `DoneScreen`. `PreWorkoutScreen` does not show the timer (it is the pre-start screen).

---

## 4. Zustand Store + Persist

### Why
`workout-screen.tsx` currently holds ~20 `useState` values and 5 `useRef` values. A page reload clears all of them. The refs hold timestamps (`lapStartRef`, `restStartRef`, `exerciseStartTimeRef`, `workoutStartRef`, `workoutEndRef`) — these are the most critical to survive a reload.

Zustand `persist` middleware serialises the store to `localStorage` on every state change and rehydrates on mount. This makes a reload transparent — the user returns to the same screen they were on.

### Store shape

```ts
interface WorkoutStore {
  // Session identity
  workoutSessionId: string          // pre-seeded UUID, stable for the session
  sessionType: string | null

  // Flow mode
  mode: WorkoutMode                 // "pre" | "warmup" | "active" | "exercise-summary" | "done"
  currentIdx: number
  soloMode: boolean

  // Exercise / set state
  sets: number
  reps: number[]
  perSetWeights: number[]
  setWeights: number[]              // weights actually logged in current exercise
  currentSet: number
  lapTimes: number[]
  workoutPhase: "rest" | "set"
  accumulatedRestMs: number
  restTimes: number[]
  timerStarted: boolean

  // Timestamps (ms since epoch; previously refs)
  workoutStartMs: number | null
  workoutEndMs: number | null
  exerciseStartMs: number | null
  lapStartMs: number | null
  restStartMs: number | null

  // Derived / results
  summaryData: ExerciseSummaryData | null
  todayLogged: string[]             // serialised as array (was Set<string>)
  sessionLog: SessionLogEntry[]

  // Actions (full list in implementation plan)
  startWorkout: (sessionType: string) => void
  resetSession: () => void
  setMode: (mode: WorkoutMode) => void
  setCurrentIdx: (idx: number) => void
  setTimestamps: (patch: Partial<Pick<WorkoutStore, 'workoutStartMs'|'workoutEndMs'|'exerciseStartMs'|'lapStartMs'|'restStartMs'>>) => void
}
```

### Persistence key
`ta_workout_state` in `localStorage`.

### On mount
If persisted state exists and `sessionType` matches the current route param, restore. If `mode === "done"` in persisted state, call `resetSession()` so the done screen is not shown on re-entry.

### On complete
`resetSession()` clears the store and removes the localStorage entry after the done screen is shown.

### What is NOT persisted
`exercises` (refetched from API), `loading`, `logging`, `loggedCount`, `calendarLoading`, `calendarAdded`, `sessionElapsedSec` (derived).

---

## 5. Data Capture Improvements

### New timestamps recorded per set

| Field | When stamped |
|---|---|
| `setStartMs` | When "Start Set" is pressed (currently `lapStartRef.current = Date.now()`) |
| `setEndMs` | When "Log Set" is pressed |
| `setTimeSec` | `setEndMs − setStartMs` (already tracked as `lapTime`) |
| `restBeforeMs` | `setStartMs[n] − setEndMs[n−1]` (currently tracked as `restTimes`) |

No new user-facing actions — these are derived from existing timestamps already captured.

### Inter-exercise rest

`interExerciseRestSec` = `exerciseStartMs_next − setEndMs_last` for the previous exercise.

This is stamped when the user presses "Begin Exercise" on the ready screen (`exerciseStartMs` set at that point). It is included in the **current** exercise's `/api/log-exercise` payload as `timeSinceLastExerciseEndSec` — meaning it describes how long the user rested before starting this exercise. No PATCH to the previous exercise is needed.

**Note on last set of session:** The final exercise has no "next exercise" start time. We use `workoutEndMs` (when "Complete Workout" is pressed on the done screen) as a proxy. This is an approximation — it includes time on the summary and done screens — but it is the best available.

### API payload additions

`/api/log-exercise` POST body gains two optional fields:
```ts
setStartTimes?: number[]   // ms epoch per set
setEndTimes?: number[]     // ms epoch per set
interExerciseRestSec?: number
```

These are stored in `set_logs` (two new nullable INTEGER columns `set_start_ms`, `set_end_ms`) via a new migration. `interExerciseRestSec` stored on `exercise_logs` (new nullable column `inter_exercise_rest_sec`).

---

## File Change Summary

| File | Change |
|---|---|
| `lib/stores/workout-store.ts` | New — Zustand store with persist |
| `components/workout-screen.tsx` | Replace useState/useRef with store; pass `sessionElapsedSec` + `workoutStartMs` to children |
| `components/workout/pre-workout-screen.tsx` | Pills open stats sheet; remove `onLaunchExercise` from pill tap; add re-do button for `todayLogged` exercises |
| `components/workout/active-workout-screen.tsx` | Add warmup strip to ready screen; remove it from active view; receive `sessionElapsedSec` |
| `components/workout/warmup-screen.tsx` | Receive and display session timer |
| `components/workout/exercise-summary-screen.tsx` | Receive and display session timer |
| `components/workout/done-screen.tsx` | Receive session timer; call `resetSession()` on mount |
| `components/workout/exercise-stats-sheet.tsx` | New — stats bottom sheet (1RM table, trendline, muscle map) |
| `components/workout/types.ts` | Extend `ExerciseSummaryData` with timing fields |
| `app/api/log-exercise/route.ts` | Accept `setStartTimes`, `setEndTimes`, `interExerciseRestSec` |
| `lib/data/postgres/migrations/015_set_timing.sql` | Add `set_start_ms`, `set_end_ms` to `set_logs`; `inter_exercise_rest_sec` to `exercise_logs` |
| `lib/data/postgres/schema.ts` | Schema additions for new columns |
| `lib/data/postgres/adapter.ts` | Write new timing columns |

---

## Known Constraints

- `zustand` v5 is already installed (`package.json`)
- `ExerciseHistorySheet` already exists (used in the stats screen). `ExerciseStatsSheet` is a new component that reuses the same `/api/exercise-history` fetch but adds the 1RM rep targets table and inline muscle map. The old sheet is not modified.
- The `soloMode` path in `workout-screen.tsx` is retained but only reachable via the re-do button
- Refs (`lapStartRef`, `restStartRef`) in `ActiveWorkoutScreen` are passed as `MutableRefObject` so children always read fresh `.current` — these can remain as local refs derived from store timestamps on each render, or be removed and replaced with store reads directly in child components
