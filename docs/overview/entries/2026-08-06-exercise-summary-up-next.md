# 2026-08-06 — "Up Next" exercise + starting weight on the rest/exercise-summary screen

**Domain:** workouts — v1.267.2, JS-only (no APK rebuild)

## The report

Q-87 (owner UI-bug batch): the post-exercise "RESTING" screen shows the sets just completed but
nothing about what's coming next, so there's nothing to mentally prepare with during the rest
countdown.

## The fix

Cheap, exactly as the plan traced it — everything needed was already resolved in scope at the
`commitExerciseSummary` call site in `handleCompleteSet` (`components/workout-screen.tsx`):
`effectiveExercises[store.currentIdx + 1]` is the next exercise (or `undefined` at the end of the
session), and its planned starting weight is `computeInitialWeights(nextEx, 1)[0]` — the exact
set-1 weight formula the per-set-weights init effect uses when that exercise actually starts, not
the pre-workout screen's "last time" line (which is last-*logged* weight and can differ from what
the set opens with today).

- `ExerciseSummaryData` (`components/workout/types.ts`) gained a `nextExercise: { name,
  startingWeight, exerciseType } | null` field.
- `exercise-summary-screen.tsx` renders an "Up Next" card (name + weight, bodyweight-safe — shows
  "Bodyweight" instead of "0 kg") right after the HR chart, only when `nextExercise` is non-null.
  Last exercise of the session → the field is `null` → the card doesn't render, no empty/broken
  state.

## Verification

Typecheck and lint clean (pre-existing, unrelated `voice-log-button.tsx` missing-module error,
confirmed via `git stash` diff). Full suite: 401 files / 3,175 tests green.

Ran the real workout flow end-to-end against the local DB with Playwright (not a mock): logged in,
started the seeded Push session, skipped warmup, logged all 3 sets of the first exercise (Barbell
Bench Press) through the real Log Set / rest-skip UI, landed on the exercise-summary screen, and
confirmed the "Up Next" card renders "Barbell Overhead Press — 60 kg" in both light and dark
themes. Test workout data (2 incomplete sessions from the two theme passes) cleaned up from the
local DB afterward.

**Not exercised:** the last-exercise-of-session (no next exercise) case wasn't separately
screenshotted — `effectiveExercises[idx + 1]` returning `undefined` past the array end is a
language guarantee, not something that needs an on-device rerun to trust, and the `nextExercise &&
(...)` render guard is the only thing standing between that and a broken UI. No on-device (S25)
confirmation — JS-only change, no safe-area/gesture/native surface.
