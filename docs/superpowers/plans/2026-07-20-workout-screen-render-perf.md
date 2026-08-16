# Fix: workout-screen orchestrator re-renders on every weight-dial tick

**Source:** `docs/reviews/2026-07-20-wiring-caching-perf-audit.md` §2.1. Branch:
`fix/workout-screen-hotpath-selector`.

## Problem

Every scroll-wheel weight-dial tick or rep change during active logging — the single most frequent
interaction in the app — re-renders the entire 1680-line workout orchestrator (recomputing its
`effectiveExercises`/`sequence` memos and re-diffing every child), even though `SetCard` itself is
already correctly memoized. This is the literal violation of CLAUDE.md's render-discipline rule:
"Hot-path fields (per-set weight, RPE value) are read by the leaf that renders them via its own
selector — never threaded through an orchestrator's broad `useShallow` pick."

## Root cause

`components/workout-screen.tsx:104-178` subscribes to `useWorkoutStore` with a single `useShallow`
selector that includes `reps: s.reps`, `setWeights: s.setWeights`, `lapTimes: s.lapTimes`, and
`restTimes: s.restTimes` alongside ~20 other orchestrator-level fields (mode, phase, refs, etc).
`handleWeightChange` (`:927`) calls `store.updatePerSetWeight` on every dial tick;
`handleRepChange` (`:922`, deps `[store.reps]`) fires on every rep change. Both mutate fields
inside the broad selector, so React re-renders the whole orchestrator component tree on every
tick, not just the leaf (`SetCard`/`WeightDial`) that actually displays the changed value.

## Fix

Move `reps`, `setWeights`, `lapTimes`, and `restTimes` out of the orchestrator's `useShallow`
selector. Each of these fields is only actually *read for display* by a leaf component
(`SetCard`, the weight-dial modal, the rest-ring/lap displays in `active-workout-screen.tsx`) —
have those leaves subscribe to their own narrow Zustand selector for just the slice they render
(e.g. `useWorkoutStore(s => s.setWeights[exerciseId]?.[setIndex])`), matching the pattern
CLAUDE.md's rest-ring/lap-counter reference implementation already uses for timers. The
orchestrator keeps using `store.updatePerSetWeight`/`store.reps` (read via `getState()` or a
narrow selector) only where it genuinely needs the *current* value for logic (e.g. building the
payload on Log), not for reactive rendering.

Do this incrementally, one field at a time, verifying after each that the orchestrator no longer
re-renders on that interaction (React DevTools profiler or a temporary render-count log) before
moving to the next — `workout-screen.tsx` is the highest-risk file in the app (CLAUDE.md names it
first among hotspots), so this must not be a single large diff.

## Files touched

- `components/workout-screen.tsx` (narrow the `useShallow` selector)
- `components/workout/set-card.tsx` (own selector for its weight/reps slice, if not already reading
  via props from a leaf-level selector)
- `components/workout/active-workout-screen.tsx` (own selectors for lap/rest display, consistent
  with the existing `useElapsedSec`/rest-ring leaf pattern)
- Any other leaf reading these fields via orchestrator props today — grep
  `setWeights\|lapTimes\|restTimes` prop-drilling from `workout-screen.tsx` before starting.

## Verification

- `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build` green.
- `pnpm dev`: start a workout, adjust a weight dial repeatedly, confirm via React DevTools
  Profiler (or a temporary console render-counter) that `WorkoutScreen` itself no longer re-renders
  on each tick — only the leaf showing the changed value does.
- **Device-smoke gate required** (per CLAUDE.md Canonical Runtime — this changes core workout-flow
  render behavior): run the full active-workout flow on the S25 APK (log several sets across
  multiple exercises, verify no dropped ticks, no stale displayed weight, rest timer and lap
  counters still update correctly) per `docs/device-smoke-checklist.md`. If no device is available
  this session, land with an explicit "NOT device-verified" Known-Issues row — do not claim it
  fixed the perceived lag without on-device confirmation, since perceived responsiveness is
  W eb-sandbox-invisible.

## Rollback

Revert to the single broad `useShallow` selector — this is a pure render-optimization refactor
with no data/schema change, safe to revert wholesale if a regression surfaces (e.g. a leaf reading
stale state because its narrow selector was scoped incorrectly).
