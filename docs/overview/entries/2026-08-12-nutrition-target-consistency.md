# 2026-08-12 — Macro targets that say when they do not add up

**Release:** v1.297.0 · **Domain:** nutrition · **Branch:** `fix/nutrition-target-macro-consistency`
**Closes:** Q-191, open since 2026-08-11 — filed while building the meal-plan portion scaler.

## What was wrong

`PUT /api/nutrition/targets` takes `calories`, `proteinG`, `carbsG` and `fatG` as four independent
numbers, and nothing ever made them agree. The seeded account holds **150P / 180C / 60F beside a
1,750 kcal goal** — 1,860 by Atwater, a **110 kcal disagreement the user had no way to see**.

Anything planning against both is solving an unsatisfiable problem. The meal plan hit it
immediately: every plan read "over by 110 kcal" for reasons that had nothing to do with the food.
v1.287.0 worked around it at read time with `reconcileDailyMacros`, but the *source* stayed free to
drift and every future consumer would have needed the same workaround.

## What it does now

The targets editor computes what the four numbers actually come to and, when they disagree by more
than `MACRO_GOAL_TOLERANCE_KCAL` (25 kcal — a goal is typed, not measured), says so plainly and
offers **Fit carbs to 1,750 kcal (153 g)** as one tap. Carbs are the remainder because that is the
convention `calculateBaseline` and `carbsFromRemainder` already use — protein and fat are the
numbers people set on purpose.

**Shown, not enforced.** A saved row is never silently rewritten on read; `reconcileDailyMacros`
stays as the guard for rows that already drifted or that another writer produces. The editor is a
prompt the user chooses to act on.

## The bug the tests found

Writing the test for "an agreeing row is passed through untouched" failed, and the reason is worth
keeping: **`reconcileDailyMacros` was flagging its own helper's output as drifted.**

`carbsFromRemainder` rounds to a whole gram, and a gram of carbohydrate is 4 kcal — so on a
1,750 kcal goal it returns **153 g, implying 1,752 kcal**. The reconciler's tolerance was **±1 kcal**.
So taking the new one-tap fix would have produced a row the meal-plan review step then described as
*"your saved macros did not add up"* — immediately after the user made them add up.

`MACRO_RECONCILE_TOLERANCE_KCAL` is now 2 kcal, named and documented as "at least the rounding of a
whole gram of carbohydrate", with a test asserting it covers that rounding while staying well inside
the editor's own 25 kcal threshold.

## Verification

`tsc` clean · 0 lint errors · 17/17 custom checks · **452 files / 3,727 tests green** (9 new).

The tests pin the real seeded numbers (1,860 vs 1,750), that the fix changes only carbohydrate,
that it never asks for negative carbs when protein and fat already exceed the goal, and that showing
the gap does **not** remove the need for read-path reconciliation.

## Not exercised

Not verified on device — this is a form in the profile pane, no local-store path. No migration, no
schema change, no sync-path change.
