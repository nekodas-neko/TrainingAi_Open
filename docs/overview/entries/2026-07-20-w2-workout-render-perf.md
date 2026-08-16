# 2026-07-20 — W2: workout-screen render-perf (wiring/caching-perf audit §2.1)

**Branch:** `fix/workout-screen-hotpath-selector` · **No version bump** (pure render-optimization, no behavior change)

Second item of the wiring/caching-perf audit batch. **Re-verifying the plan against `main` first
found the audit's root-cause was wrong** — a good catch worth recording:

- The audit said the orchestrator's broad `useShallow` pick re-renders the 1680-line `WorkoutScreen`
  on every weight-dial tick. But the dial calls `updatePerSetWeight`, which mutates `perSetWeights`
  — a field the orchestrator **never** subscribed. Its author had already deliberately isolated it.
- The real dial-tick hot path was the **814-line `ActiveWorkoutScreen`**: it subscribed the *whole*
  `perSetWeights` array (line 98) and fed `SetCard` / the warmup ramp / the working-weight header /
  live-1RM by value, so every detent re-rendered all 814 lines + recomputed its memos.

I surfaced the discrepancy and the owner chose the fuller, more future-proof fix.

## What landed

**Real dial-tick hot path (new leaves):**
- `components/workout/active-set-card.tsx` — memoized leaf that self-subscribes the current set's
  weight/reps/lap/rest/RPE slices and renders the (still presentational) `SetCard`.
- `components/workout/sets-grid.tsx` — the per-set recap grid, extracted as a memoized leaf that
  self-subscribes the hot arrays (it shows the active cell's live load, so it's on the dial path).
- `live-1rm-readout.tsx` / `pip-view.tsx` — now self-subscribe their own weight/rep slices instead
  of taking them as props.
- `ActiveWorkoutScreen` now reads only `perSetWeights[0]` (working-weight header + warmup ramp), so
  dialing any set past set 1 no longer re-renders it at all — only the small leaves update.

**Orchestrator pick narrowed (the plan's original intent, still valid):**
- Removed `reps`/`setWeights`/`lapTimes`/`restTimes` from `WorkoutScreen`'s `useShallow`; its event
  handlers (log snapshot, rep ±, complete-set) read them via `useWorkoutStore.getState()` at call
  time, and the leaves self-subscribe. The orchestrator no longer re-renders on rep-edits/appends.

Net: every value rendered is identical — only *which* component re-renders on a hot-path mutation
changed. Trivially revertible (no data/schema change). Also trims `ActiveWorkoutScreen` below the
800-line guidance (addresses the §2.5 hotspot advisory in passing).

## Verification

- tsc + lint clean (0 errors; the 5 remaining warnings are pre-existing unused-imports). Workout /
  store / component tests green (145). Production build green.
- **NOT device-verified (Known-Issues row):** the perceived-smoothness improvement is APK-only and
  web-sandbox-invisible — needs the S25 active-workout smoke (no dropped dial ticks, no stale
  displayed weight/reps, rest ring + lap/rest counters still update, live-1RM + warmup update as the
  set-1 weight changes) per `docs/device-smoke-checklist.md`.
