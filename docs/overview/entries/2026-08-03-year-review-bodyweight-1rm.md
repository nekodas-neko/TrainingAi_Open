# 2026-08-03 — a pull-up outranked a bench press as the year's biggest lift

_Branch `fix/year-review-bodyweight-1rm` · v1.252.4 · domain `workouts`_

## What the finding said, and what it actually was

`projectOverview.md` picked this up on 2026-08-03 as an aside inside a bigger 1RM-plausibility
concern:

> bodyweight movements carry meaningless absolute values (Hanging Leg Raise "128 kg", Pull-Up
> "118 kg") which makes their trend unreadable — worth excluding bodyweight lifts from any
> stall/trend judgement.

**The recommendation was wrong, and the diagnosis was half right.** A bodyweight `estimated_1rm` is
a `BW_REF`(100)-relative index — a monotone function of reps and added load — so its *trend* is
perfectly readable (more reps ⇒ up) and it should stay in stall/trend judgement. What is meaningless
is the *absolute number*, and only when something prints "kg" after it. The repo already decided
this: `displayOneRm`/`oneRmUnit`/`oneRmLabel` exist precisely so a bodyweight 1RM renders as
`6 RM`, and there is a prior finding (Q-12) about a `BW_REF` change reading as a +40% strength gain.

So the question was not "should trend exclude them" but **"which surface is still printing the index
as kilograms"**. A sweep of every 1RM render found the digests correct (they route through
`describePersonalRecord`, finding Q-19), the workout screens correct (all three branch on
`exerciseType`), and two that were not.

## Bug 1 — Year in Review picked the wrong PR, not just the wrong label

```ts
prs.reduce((max, pr) => pr.estimated1rm > max.estimated1rm ? pr : max)
```

That maximises across two incomparable units. Measured against production the same day:

| Exercise | stored `estimated_1rm` | basis |
|---|---|---|
| Barbell Hip Thrust | 154.5 | kg |
| Barbell Calf Raise | 131.3 | kg |
| **Hanging Leg Raise** | **128.0** | **BW index** |
| **Pull-Up** | **118.3** | **BW index** |
| Barbell Bench Press | 96.0 | kg |
| Barbell Squat | 87.5 | kg |

Two bodyweight movements sit 3rd and 4th, above the bench press and the squat. Any year window whose
weighted PRs top out below ~128 headlines a hanging leg raise as the biggest lift of the year — and
then labels it kg. This is a **selection** defect; relabelling alone would still have named the wrong
exercise.

Fixed with `pickHeadlinePersonalRecord` in `packages/shared/src/1rm.ts`, next to
`describePersonalRecord` so the two cannot drift: rank the weighted records against each other in
kilograms, and fall back to the best bodyweight record **only when there are no weighted ones at
all**, so a bodyweight-only trainee still gets a headline and no comparison ever crosses the bases.

## Bug 2 — the deload sheet's kg target

`deload-info-sheet.tsx` rendered `` `(~${mround125(oneRm * s.pct / 100)}kg)` `` with no type check.
The chip that opens it appears for any deloaded exercise, bodyweight included, so a 118-index pull-up
at 80% displayed "(~94.5kg)" — a weight nobody ever moved. The `sets×reps @ pct%` line reads fine
without it, which is the same call `pre-workout-screen.tsx` already made for its rationale bullets.

## Checked and found correct — recorded so a later sweep does not "fix" them

- **`live-1rm-readout.tsx`** labels its projection `kg` unconditionally, which looks like the same
  bug. It is not reachable: the call site guards on `exercise?.exerciseType !== "bodyweight"`.
- **The daily and weekly digests** already build a name→type map and call `describePersonalRecord`.
- **`active-workout-screen.tsx`** (both sites) and **`pre-workout-screen.tsx`** already branch.

## Plumbing

Neither `getYearReviewTopExercises` nor `listRecentPersonalRecords` returned an exercise type, so
the route could not have made this decision. Both now `LEFT JOIN exercise_library` and carry
`exerciseType` through to `YearReviewResponse`. The digests keep their own map — changing them was
out of scope and they are already correct.

## Verification

- **Five tests** on `pickHeadlinePersonalRecord`, built from the production table above. Confirmed
  they fail against the old plain-`max` (2 of 5 red when the filter is removed), so they pin the
  behaviour rather than describing it.
- **Both selection branches exercised live** on the dev server, after seeding a bodyweight PR of 175
  — above every weighted one:
  - mixed → `{"exerciseName":"Barbell Deadlift","estimated1rm":160,"exerciseType":"weighted"}`. The
    numerically larger 175 is correctly passed over.
  - weighted PRs aged out of the window → falls back to
    `{"exerciseName":"Diamond Push-Up","estimated1rm":175,"exerciseType":"bodyweight"}`, which the
    screen renders as **18 RM**, not 175 kg.
- **The `topExercises` join verified** by flipping a seeded exercise's library type and confirming
  `exerciseType` flows through the grouped query. The dev database was restored afterwards.
- Typecheck clean, lint 0 errors.

## Not verified

The **rendered** Year in Review page. Its data is fetched client-side, so the server HTML carries
none of these strings, and this repo has no React render-test setup. What is proven is the payload
and the `displayOneRm` values it feeds (`18 RM` / `160 kg` asserted directly). The remaining risk is
layout, not correctness.

## What this deliberately does NOT do

The finding's larger half — implausible 1RM growth on four weighted lifts (bent-over row +45.8%,
incline bench +38.7%, barbell shrug +37.6%, calf raise +38.5% over seven weeks) — is untouched and
its `projectOverview.md` row stands. That is a different question (loads ramping from a start below
true capacity, and/or estimator drift) and it needs its own measurement pass.
