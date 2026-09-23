# 2026-09-23 — LA-125: one fat rule, and it is the floor

**Branch:** `lane-a/la125-fat-floor-in-baseline` · **Lane A** · one shared module and its two
callers' tests. No migration, no schema change, no route change.

## The measurement held exactly

`calculateBaseline` set `fatG = round(calories × 0.25 / 9)`; `clampRecommendation` floored fat at
`round(0.6 × weightKg)`. Both verified against current `main` at the stated lines. For the owner
that is **39 g and 42 g**, with carbs falling out of the remainder at **143 instead of 150**. So
RV-66's claim — the recommendation *is* the baseline — was true of calories, protein, water and
steps and false of the two macros a person actually adjusts.

## What shipped

The floor moved **into** `calculateBaseline`, as the entry's decided structural call says. Both
bounds are now one pair of helpers — `fatCeilingG(calories)` and `fatFloorG(weightKg, calories)` —
used by the baseline and by the clamp, so there is one expression rather than two copies of the
same two numbers. The clamp keeps them as a redundant guard over a figure it did not compute.

**It resolves in favour of 42 g, not 39.** That is worth stating plainly because `LA-126` was
written expecting the opposite, and it is the entry LA-125 was blocking.

## What the entry did not say, and it is the reason the clamp's shape had to be copied exactly

`clampRecommendation` does not floor at `0.6 × weightKg`. It floors at
`min(round(0.6 × weightKg), fatMax)` — for a very heavy, short or older person the weight-based
floor can exceed the 40%-of-calories ceiling, and an existing test pins that case at 150 kg. A
floor written into the baseline without that cap would have pushed fat past 40% of the budget for
exactly those users, and the clamp would then have pulled it back down — re-creating the
disagreement at the other end of the range. `fatFloorG` carries the cap, which is why it takes
`calories` as well as weight.

## The blast radius, which is a real change to a number

One baseline fixture moved: an 80 kg cutting profile at 1,636 kcal computed **45 g fat / 164 g
carbs**, under its own 48 g floor. It is now **48 / 157**. That is the defect, not a regression —
the route would have raised that user to 48 g anyway, and the sheet was showing them 45.

`components/profile/goal-baseline.ts` (the recommendation sheet) reads `calculateBaseline`
directly, so it now shows the same number the route serves. That is the point of the change, and
it is also where the owner sees the figure before he taps apply.

## `LA-126` was amended in this PR, because it quotes figures this change moves

It states the numbers the owner is moving to "so nobody has to re-derive them" — **1,359 / 111 /
143 / 38**. Its 38 g fat is the pre-floor value; his floor is 42 g whichever body-fat reading is
used, so the expected figures are now **1,359 / 111 / 134 / 42**. That is arithmetic from the
entry's own numbers and is flagged in it as such, **not** a fresh measurement — the RV-66 re-run is
what settles it. Left unamended it would have handed the next session a stale target.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | baseline drops the floor (the defect restored) | killed — 2 tests |
| 2 | `fatFloorG` loses its ceiling cap | killed — the 150 kg case |
| 3 | baseline takes `min` of target and floor instead of `max` | killed — 6 tests |
| 4 | clamp stops using the shared floor (`fatMin = 0`) | killed — 2 tests |
| C | the three constants inlined as `0.25` / `0.4` / `0.6` literals | **survived** (correct) |

The control is the one that matters here: extracting named constants must not change a number, and
it did not.

## Not done

- **The clamp is still called, and must be.** Its *calorie* floor is load-bearing for every cutting
  user — `CALORIE_ADJUSTMENT_BY_GOAL` subtracts 500, and `bmr × 1.2 − 500 < bmr` for any BMR under
  2,500. The entry warns against closing this by deleting the clamp; that warning is correct.
- **No re-run of the owner's recommendation, and no write to his targets.** `LA-126` is explicit
  that the write is his one tap, and a decision recorded in a backlog entry is not a hand on the
  database.
- **Failure surfaces not exercised:** the device, and production data. The change is pure
  arithmetic in a shared module, but the sheet that renders it has not been looked at on the S25.
