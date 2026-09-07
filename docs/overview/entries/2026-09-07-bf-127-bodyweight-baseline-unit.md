# 2026-09-07 — BF-127: the app told him to load 82.5 kg on a pull-up

**Branch:** `fix/bf-127-bodyweight-baseline-unit` · **Lane B** · v1.436.26

The owner, on a Pull session: *"pull up = weight"*. The baseline banner listed **Pull-Up — 82.5 kg**
under *"Suggested starting weights (≈70% of PR)"*.

## The number was never kilograms

`personal_records` holds `Pull-Up estimated_1rm = 118.25`, and `exercise_library.exercise_type` is
`bodyweight`. A bodyweight 1RM is computed against **`BW_REF = 100`** — a fixed stand-in for the
lifter's body weight, so the value is an index driven by reps and added load. The owner weighs
**70.65 kg**. Seventy percent of 118.25 is 70% of nothing physical.

**The repo already forbade this**, in a comment written after Q-12 found the same class:

> *"bodyweight strength is measured in REPS, never kilograms … Rendering it as kg is what let a
> change of the BW_REF constant read as a +40% strength gain … Every surface that shows a stored 1RM
> resolves its unit here rather than hardcoding 'kg'."*

`displayOneRm()` / `oneRmUnit()` are that resolver. The banner called neither — while the exercise
card **six lines below it** rendered `5 × 0kg · 5 RM` correctly for the same exercise.

## What shipped

`components/workout/baseline-hints.ts` returns a union — `load` (kg), `bodyweight` (with the rep max
when known), or `unknown` — and the banner renders each case instead of formatting one number three
ways. The heading no longer promises a weight for every row: *"Suggested starting point"*, with the
70% basis moved into the explanatory paragraph where it is true only of weighted movements.

**A bodyweight row offers no number to load and does not invent one.** 70% of a rep max is not a
prescription — reps do not scale that way — so it says `Bodyweight` and reports the rep max beside
it as the reference an AMRAP is measured against.

## The entry's stated fix does not work, and the reason is worth keeping

BF-127 says *"`signals.exercises[]` already carries `exerciseType` (signals.ts:277); the banner's
`.map()` simply does not read it."* That line is real, and it is on the **wrong shape**.

There are two exercise signals in that file. `ExerciseSignal` (`:25`) carries `exerciseType` and
exists **for the LLM prompt** — its own comment says so (Q-19b). `CardExerciseSignal` (`:116`) is
what reaches the client, and it has six fields, none of them the type. Threading it from there would
have meant editing `packages/shared/**`, which is **Lane A's**.

It was not needed. The component's `exercises` prop, from workout-data, already carries
`exerciseType` — it is the source the card below the banner uses — so the fix joins on
`sessionExerciseId` and stays entirely in Lane B. Keyed by id rather than name, because one session
can hold two exercises with the same name. A separate map from the existing `exerciseTypeById` is
needed because that one is only populated when a prescription exists, and the baseline banner runs
before there is one.

## The sibling sweep the entry asked for, and its result

*"Any other surface multiplying or formatting `current1rm`/`estimated_1rm` without going through
`oneRmUnit`."* Five candidates, and **the banner was the only unguarded one**:

| site | verdict |
|---|---|
| `active-workout-screen.tsx:288` | guarded — `isBodyweight ? displayOneRm(…) : "… kg"` |
| `active-workout-screen.tsx:345` | guarded — the whole block is `!isBodyweight &&` |
| `active-workout-screen.tsx:354` | guarded — `isBodyweight ? null :` above it |
| `workout-screen.tsx:76,80` | guarded — `computeInitialWeights` returns zeros for bodyweight |
| `exercise-stats-sheet.tsx:83` | not a display — `workingWeight` feeds `calc1RM`, and the bodyweight branch handles `BW_REF` explicitly |

Q-12 built the resolver and this is the one caller that escaped it. The sweep is worth recording as a
result rather than a to-do: nothing else needs changing.

## Verified

Twelve unit cases, including the owner's live figures — `baselineHint(118.25, 'bodyweight')` produces
no `82.5` anywhere in its output — that a weighted row's number is unchanged (92.5 → 65 kg), the
no-history and unknown-type fallbacks, and three source guards on the banner and its call site.

Two cases guard the **premise**: that `BW_REF` is still 100 (if it ever becomes the real body weight,
the basis of this fix changes and the guard fails), and that the shared resolver still answers `RM`
for bodyweight and `kg` otherwise.

`tsc` clean · lint clean (the one warning in `components/workout/` is pre-existing, in
`exercise-stats-sheet.tsx`) · `pnpm check:rules` **Ran 68 of 68** · `check-test-typecheck` at
baseline · full unit suite green.

## Not exercised

**Not seen on a screen.** The banner renders only in the `baseline` phase with
`baselineComplete === false`, which the seeded dev user is not in; reaching it means driving a
program into its first session. The unit logic is unit-tested against the owner's own stored figures
and the render path is pinned by source guard.

**Not verified on device.** The owner sees this on the S25, on a real Pull session — the row should
read `Bodyweight` with his rep max beside it, and no kilograms anywhere on it.
