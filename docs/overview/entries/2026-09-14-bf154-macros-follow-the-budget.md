# 2026-09-14 — the macro grams follow the budget, and the gap module goes with them (BF-154)

**Branch:** `lane-a/bf154-macro-rebase` · **Lane:** A · Entry **BF-154**, build half. The arithmetic
half shipped 2026-09-13 in #1155; this is the change the owner actually asked for.

## The decision, and the defect under it

Owner, 2026-09-13: *"Can we have it dynamically sized for my calories? I.e before excercise its 1
value and after its another if calories increase?"*

The stored grams were entered against the stored calorie goal. BF-152 moved the day's budget onto the
measured resting rate, and the two then disagreed permanently — ~1,660 kcal of grams against a ~1,294
budget on his figures.

**The gap was constant, and that is what made it a design fault rather than a rounding one.** The old
code grew the grams by `earned` and the budget by the same `earned`, so the difference never moved
however far the day was walked. `macro-budget-gap.ts` existed only to measure a number no arithmetic
was ever going to close. Both properties are now pinned as tests, in both directions.

## What shipped

`macrosForKcal(base, totalKcal)` in `packages/shared/src/nutrition/calorie-balance.ts` — hold
protein, fit carbs and fat to what is left, preserving the carbs:fat **energy** ratio.
`scaleMacrosForEarnedKcal` now delegates to it, so "hold protein, move the rest on the ratio" has one
implementation rather than two that can disagree at the edges. The 466 existing nutrition tests
passed unchanged across that refactor, which is what makes it a refactor.

`energy-balance-service.ts` fits both halves to the budget: `base` at `budgetProvenance(...).base`,
`scaled` at `base + earned`, from the **same inputs** `computeCalorieBalance` was handed rather than
a second derivation. The missing-profile path passes `null` and keeps the stored grams — there is no
budget to fit to when the BMR the anchor needs cannot be computed, and a target a human typed beats
one fitted to a number that does not exist.

**Protein holds, and the reason is arithmetic.** It is dosed per kg of bodyweight, so neither a walk
nor a smaller budget changes what the body is made of. When protein alone would exceed the whole
total, carbs and fat go to zero rather than negative.

## Measured on the running app, not argued

| | grams cost | budget | gap |
|---|---|---|---|
| at rest | 1,816 | 1,815 | **1** |
| after a run earning 187 kcal | 2,005 | 2,002 | **3** |

Protein held at 150 g on both. One to three kcal of gram-rounding where several hundred used to
stand, and the grams move with movement — which is the sentence the owner wrote.

**⚠ The sandbox cannot show what his account will do.** The seeded user's budget base is *above* its
stored goal, so its carbs went up (166 → 178). His is below, so **his carbs and fat will visibly
drop** while 150 g protein stands. Right for a cut, and the thing to look at on the first day.

## What was deleted, and why nothing was lost

`macro-budget-gap.ts`, its test, the card's breakdown paragraph, and three props that fed it
(`storedGoalCalories`, `baseKcal`, `baseIsRestingRate`) plus their call sites. A gap that is zero by
construction needs no module to measure it and no sentence to explain it.

**The budget's provenance survives.** `CalorieZoneBar`, rendered by this same card, prints
`{base} resting rate` on the anchored path and is now the only surface that does — so BF-152's owed
device check still has something to check, and the duplication the report opened with (*"There is so
many numbers here"*) is settled rather than kept in sync.

**Two guards were re-pointed rather than deleted**, which is the part worth being careful about.
`bf154-budget-breakdown-addends.test.ts` lost four assertions whose subject is gone; its arithmetic
block is untouched and its "no figure labelled resting twice" test now reads the surviving surface.
`e2e/bf154-budget-breakdown-reconciles.spec.ts` follows the same property to `CalorieZoneBar`'s
sentence, stripping the earned parenthetical so `earned`'s own addends are not counted as terms of
the budget. Both pass locally.

## Verification

**Mutation pass, real exit codes:** dropping the protein floor (1 failed), scaling protein instead of
holding it (12 failed), swapping the carb/fat shares (6 failed). One deliberately equivalent control
— `carbShare` computed as `1 − fatKcal/splittable` — survived, as it should.

Full suite **911 files / 8,647 tests, 0 failed** by real exit code; `pnpm check:rules` 75 of 75; lint
0 errors; build clean; the re-pointed E2E spec green locally.

**Not exercised:** the device. JS-only, so it reaches the phone on the next Railway deploy with no
APK, but nothing has read the macro row at 412 dp — and the figure that matters there is his, which
this machine cannot produce.
