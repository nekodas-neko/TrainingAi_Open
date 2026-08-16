# Live 1RM Readout — Design Spec

**Date:** 2026-07-01
**Status:** Approved (pending spec review)
**Branch:** `claude/screen-safe-spacing-pokr38`

## Goal

During an active workout, show a small live widget under the rest-timer ring that
tells the lifter, after every logged set, their **projected 1RM for this session so
far** and how it compares to their previous 1RM. The point is immediate feedback:
you can see whether you're on track to beat your previous best — even by a single
rep — while you're still resting between sets, rather than only finding out on the
summary screen at the end of the exercise.

## User story

> As I complete each set, I want a small readout under the rest timer showing my
> running average weight × reps and the resulting projected 1RM, colour-coded green
> if I'm at or above my previous 1RM and red if I'm below, so I can judge live how
> hard to push the remaining sets.

## Placement & visibility

- **Screen:** `components/workout/active-workout-screen.tsx`, active-exercise mode,
  **rest phase only** (`workoutPhase === "rest"`), rendered directly **below the
  rest-timer ring** in the existing centre zone.
- **Appears when:** at least one set of the current exercise has been logged
  (`currentSet >= 1`).
- **Hidden for:** bodyweight exercises (`exercise.exerciseType === "bodyweight"`),
  where a 1RM projection isn't meaningful.
- **Out of scope:** showing the number anywhere other than the rest screen (no PIP /
  minimized-card variant — confirmed the "minimized set" reference meant this same
  rest screen).

## Display format

A single compact, colour-coded line:

```
Ø 25 kg × 6 reps = 76.25 kg   ▲ +9.50 kg
```

- **Left of `=`** — the running **average weight × average reps** across the sets
  logged so far (arithmetic mean of the logged weights, arithmetic mean of the
  logged performed reps). Reps shown as a whole number when whole, otherwise to one
  decimal place. Weight formatted like the rest of the app.
- **Right of `=`** — the **projected 1RM** for the session so far.
- **Delta chip** — `▲ +9.50 kg` / `▼ −2.25 kg` vs the previous 1RM. Hidden when
  there is no previous 1RM.

The `Ø` (or an equivalent "avg" affordance) signals the left side is a cumulative
average, not a single set.

## Calculation — must match the saved session number

This is the load-bearing decision: **the projected 1RM must equal the number the app
saves and shows on the exercise-summary screen ("This session")**, so the live widget
never disagrees with the summary two taps later.

- The projection is computed with the **same `calculate1RM(weights, reps, style)`**
  from `lib/1rm.ts` that `workout-screen.tsx` uses on exercise completion, fed only
  the **sets logged so far**:
  - `weights = [weightFor(0) … weightFor(currentSet-1)]` (`weightFor` resolves the
    per-set weight the same way the set cards display it).
  - `reps = reps.slice(0, currentSet)` (performed reps of logged sets).
  - `style = exercise.progressionStyle?.slice(0, currentSet)`.
- Because `calculate1RM` already computes a **per-set** 1RM (applying the per-set
  *prescription adjustment*) and averages the results, feeding it a growing list is
  exactly the running average the user wants, and at the final set it reproduces the
  summary's number precisely.
- **Why not `formula(avgWeight, avgReps)`:** a raw single calc from the displayed
  averages skips the per-set prescription adjustment, so it reads several kg lower
  and would disagree with the summary — looking like a bug. With uniform sets the two
  are numerically identical; they only diverge when a set differs (e.g. an AMRAP last
  set), and there the session-matching number is the correct one. The displayed
  `avgWeight × avgReps` remains the honest running average of the *inputs*; the `=`
  value is the session-consistent projection.

### `useFor1rm` fallback

`calculate1RM` honours the style's `useFor1rm` flags — some styles count only a
subset of sets toward 1RM. When the flagged (qualifying) sets haven't been logged
yet, `calculate1RM` returns `0`. To always show a number from set 1:

- Add `runningEstimate1RM(weights, reps, style)` to `lib/1rm.ts`:
  1. `primary = calculate1RM(weights, reps, style).estimated1rm`
  2. if `primary > 0` → return it (session-consistent path).
  3. else → return `calculate1RM(weights, reps, style?.map(s => ({ pct: s.pct, reps: s.reps }))).estimated1rm`
     — i.e. re-run ignoring `useFor1rm` so all logged sets count (prescription
     adjustment via `pct`/`reps` preserved).
- In the common case (no flags, or all sets flagged — e.g. AI prescriptions set
  `useFor1rm: true` on every set) the fallback never triggers and the number equals
  the summary exactly.

## Colour logic

Compare the projected 1RM against the previous 1RM (`exercise.estimated1rm`, the same
value the summary labels "Previous"):

- `diff = projected − previous`
- `diff > +0.5 kg` → **green** (at/above previous — a win)
- `diff < −0.5 kg` → **red** (below previous)
- `|diff| ≤ 0.5 kg` → **neutral** (essentially matching)
- `previous == null` → **neutral**, and the delta chip is hidden.

Green uses the app's success green (`#22c55e`); red uses `#ef4444`; neutral uses
`var(--color-brand)`. The projected-1RM value and the delta chip share the colour.

## Components & files

- **`lib/1rm.ts`** — add pure, exported `runningEstimate1RM(weights, reps, style)`
  (as above). No change to existing `calculate1RM`.
- **`components/workout/live-1rm-readout.tsx`** — new presentational component.
  - Props: `weights: number[]`, `reps: number[]`, `style: RMStyleSet[] | null`,
    `previousEst1rm: number | null`.
  - Responsibilities: compute `avgWeight`/`avgReps` for display, call
    `runningEstimate1RM` for the projection, derive the colour, render the line.
  - Returns `null` if fewer than one logged set or the projection is 0.
- **`components/workout/active-workout-screen.tsx`** — render `<Live1rmReadout />`
  inside the rest-phase block, below the ring, guarded by `currentSet >= 1` and
  `exercise?.exerciseType !== "bodyweight"`. Pass the sliced logged
  weights/reps/style and `exercise?.estimated1rm ?? null`.
- **`lib/__tests__/1rm.test.ts`** (or a new test file) — unit tests.

## Testing

Unit tests for `runningEstimate1RM`:
- Single logged set → equals `calc1RM` for that set (with prescription factor).
- Multiple uniform sets → equals the running average and equals `calculate1RM` over
  the same sets.
- Mixed sets (e.g. an AMRAP heavier-rep last set) → equals `calculate1RM` per-set
  average, **not** `formula(avgWeight, avgReps)`.
- `useFor1rm` subset with no qualifying set logged → falls back to all-sets average
  (> 0), and once a qualifying set is logged → matches the `calculate1RM` value.
- Empty input → `0`.

Unit tests for the colour decision (pure helper or inline function):
- `diff > 0.5` → green; `diff < −0.5` → red; `|diff| ≤ 0.5` → neutral;
  `previous == null` → neutral.

Local manual test (per project rules): run `pnpm dev` against the seeded local DB,
start a workout, log a set, and confirm the widget appears under the rest ring, that
its projected 1RM matches the summary screen's "This session" value on completion,
and that the colour flips green/red as the projection crosses the previous 1RM.

## Non-goals

- No PIP / minimized-card readout.
- No change to how 1RM is calculated or saved.
- No change to the summary or ready screens.
