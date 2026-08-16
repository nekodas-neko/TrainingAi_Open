# 2026-08-11 — Meal Plan: portions that hit the target, per-meal reroll, macro bars, real manage sheet (v1.287.0)

**Branch:** `claude/nutrition-tracking-review-eyftu1` · **Domain:** `nutrition`
**Plan:** [`docs/superpowers/plans/2026-08-11-meal-plan.md`](../../superpowers/plans/2026-08-11-meal-plan.md)
**Follows:** [`2026-08-11-meal-plan-phase-1.md`](2026-08-11-meal-plan-phase-1.md)

The owner used the feature on-device and sent four screenshots with three asks: per-meal regenerate
(only whole-plan existed), a macro UI that makes clear what changing a meal does, and a manage sheet
that lets them change more than a name.

## The bug the screenshots showed but nobody named

Two of the screenshots held the same meal, same ingredients, on the two day tabs — **Target 405 kcal
· 44C** on Rest Day and **Target 577 kcal · 90C** on Training Day, both reading "These come to 428
kcal · 60C", the training one orange with "adjust portions to close the gap".

One ingredient list cannot satisfy two targets. **A split plan therefore showed drift on at least
one variant, permanently, no matter what the model returned.** Nothing was wrong with the food.

The fix is what a person actually does: same meal, more rice on a training day. Portions are now
sized in code per variant.

## Portion scaling — and the three real bugs found while measuring it

`scaleIngredientsToTargets` (`packages/shared/src/nutrition/meal-split.ts`) assigns each ingredient
to the macro it is really for and scales each group so that macro lands on target, clamped to
0.4×–2.5× of what the model suggested. Every step below was found by running real generations
against the dev server and reading the numbers, not by reasoning about the code.

1. **Carbs only was not enough.** The first version scaled just the carb sources, on the argument
   that carbs are the only macro that differs between variants. True, but it left the *other*
   problem untouched: a measured run came back with meals 200 kcal out in both directions
   (357 against 561, 773 against 544). Generalised to all three macros — protein and carbs then
   landed exactly on every meal of both variants.
2. **Salmon classified as fat.** Energy-dominance files salmon under fat (59% of its energy), which
   emptied the protein group and sized the fish by the fat target: **32 g of protein against a 50 g
   target, measured.** Eggs, beef mince and Greek yoghurt fail identically. Now anything with ≥30%
   of its energy from protein is a protein source; nuts and avocado still read as fat.
3. **A group already overshot was left alone instead of shrinking.** A 50 g protein target forces
   ~200 g of salmon, which brings 27 g of fat before the oil is counted. The correction skipped on
   `needed <= 0`, so 15 g of olive oil stayed in a meal already past its fat target — 43 g of fat
   against 24. It now shrinks to the clamp floor.

Two prompt changes came out of the same measurements: the model was told to choose weights that get
*close* (it was reading "don't bend the numbers" as "don't try"), and to include a protein, carb and
fat source in every meal — **a meal with no fat source can never reach its fat target however it is
resized**, which is how one run produced 7 g of carbs against a 60 g target.

Measured after all of it, 4 meals, split plan: day totals **1727/1750** and **1605/1658**, protein
and carbs exact on every meal.

## The target that could not be met

Then the day total still read +110 kcal over, and it was not the food. The seeded account holds
**150P/180C/60F beside a 1,750 kcal goal** — the macros sum to 1,860. Nothing on the targets screen
enforces agreement, so **any plan built against both numbers is unsatisfiable by construction** and
shows a permanent gap that has nothing to do with the meals.

`reconcileDailyMacros` resolves it the way `calculateBaseline` already did: calories win (that is
the number the weight-change calibration produces), protein and fat are kept as chosen, carbs take
the remainder. The user's saved targets are **not written to** — the plan says in one line that it
refitted carbs and why.

That expression (`(calories − protein×4 − fat×9) / 4`) existed three times; it is now
`carbsFromRemainder`, imported at all of them.

**Left undone deliberately:** the targets editor still lets you save macros that do not add up. That
is the real fix and it is a different screen — filed as a backlog item.

## Per-meal regenerate

`POST /api/nutrition/meal-plans/generate/meal`, 40/hr (a meal is a fraction of a plan). It echoes
the caller's targets back untouched, so **a swap can never move the day's totals** — only the food
changes. Allergies are read from the database, never from the request body.

The replacement goes into **every** variant at that variant's own targets. Replacing it in only the
tab you were looking at would leave a split plan holding chicken on a training day and salmon on a
rest day in the same slot, which is not what a training/rest split means.

Measured: asked for 645 kcal / 50P / 67.5C / 24F, got **669 / 49.9 / 67.4 / 23.5**, and it honoured
the "already in this plan" list by returning white fish rather than another salmon dish.

## Macro bars

Four bars per meal (kcal/P/C/F) with a signed delta, and a day total above the list — the number a
swap is really judged against. Off-target always shows its delta, so nothing is carried by colour
alone.

The day badge keys off **all four** macros, not calories. The first version said "On target" at
1,780/1,750 kcal while carbs were 105 g short and fat 38 g over — a real reading from a real
generation. It now says "Calories fine, macros off" when that happens.

Thresholds live once in `packages/shared/src/nutrition/meal-macro-fit.ts`: 10% of the target with an
absolute floor, because 10% of a 4 g fat target is 0.4 g and nothing real lands inside that.

## Manage sheet

Meals per day, training time, and "update to my current target" — **all three are pure re-splits
through `splitMacrosAcrossMeals`, no AI, instant.** Meal names carry over by position; the sheet
says plainly that extra slots come through unnamed rather than implying new food was invented.

`replaceMealPlanStructure` rewrites variants and meals in one transaction while the plan keeps its
id, so `is_active` and `last_reviewed_at` survive and no device sees the plan vanish and reappear.

**The offline bug this exposed:** re-splitting deletes the server's variants and writes new ones
with new ids, but `applyDelta` only upserted by id and never deleted. **A device pulling a 5→3
re-split would have rendered 8 meals.** Fixed with the same delete-then-insert-by-parent shape the
program subtree uses.

Also fixed: the "Save to my meals" switch was gated on `variantIdx === 0`, so on a split plan it
looked absent on the Rest Day tab. The ingredients are the same meal either way.

## Verified / not verified

3,658 tests across 446 files, 17 custom rule checks, tsc and lint clean. Routes exercised live
against the dev database including six real generations and a real per-meal reroll. Rendered at the
412×915 S25 viewport: the manage sheet with every new control, the review step with macro bars and
the day total, and the review step *after* a per-meal reroll showing the day total updating and the
"Calories fine, macros off" badge.

**Not verified on device.** The sandbox reports safe-area insets as 0 and has no native SQLite, so
the manage sheet's real bottom clearance and the `applyDelta` subtree-delete fix are unexercised —
that last one is the change most worth watching, since it only shows up on a device that already
holds a plan and then pulls a re-split. Known-Issues row added.
