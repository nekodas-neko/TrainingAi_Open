# 2026-08-12 — A plan can add food to your meal, not just shrink it

**Release:** v1.295.0 · **Domain:** nutrition · **Branch:** `feat/meal-plan-top-up`
**Closes:** Q-210 — slice D, the one the owner suspected before it was confirmed.

> *"Say the meal plan chooses the half serving of ice cream — will it add other items to fill macros
> or will it do whole saved meals only? That could be a flaw."*

It was, and the mechanism is worse than the guess.

## What was actually wrong — measured, and not what the plan doc first said

The plan doc's first version said the ice cream's carbs needed **6.3× and the clamp stops at 2.5×**.
Writing the tests disproved that.

Full cream milk is **31 kcal of fat against 18 of carbohydrate** per 100 g, and its protein share is
22% — under `PROTEIN_SHARE_THRESHOLD` — so `dominantMacro` files it under **fat**. Whey is protein.
The meal therefore has **no carb source at all**: the carb group is empty, and no scale factor of
any size moves carbohydrate. Pinned by a test that doubles the carb target to 166 g and asserts the
result does not change.

**This changes the fix, not just the write-up.** Widening the clamp — the obvious remedy for "6.3×
was refused" — would not have helped even slightly. The gap is a missing *food*.

## What ships

`scaleWithTopUp()` (`lib/nutrition/meal-top-up.ts`) replaces plain scaling in the whole-plan route,
the per-meal route, and — via a new `scaleToTarget` flag on `PATCH .../meals/[mealId]` — the edit
sheet's saved-meal path, which is the exact route the owner's complaint travelled.

It scales, checks `mealFit()`, and if a macro is genuinely **short** asks the model for at most 3
additional ingredients, then re-scales the combined list.

**The model rather than a filler table**, because a built-in "rice for carbs, oil for fat" list
cannot see allergies, shops, or what the meal is — adding rice to an ice cream is worse than the gap.

Bounded so it can only help: once per meal, short-only (never when overshooting), and the merged
version is kept **only if it improves the fit meaningfully**.

## The threshold that the tests forced

The first guard was "keep it if it fits better". Measured: adding 40 g of **celery** to the ice cream
improves the fit by **0.4%** — celery is technically a carb source — so a bare better-or-not
comparison would have put celery in an ice cream. `TOP_UP_MIN_IMPROVEMENT` (10%) makes fewer
ingredients win a close call. Both cases are pinned: celery must fail the threshold, oats must clear
it.

`fitDistance()` deliberately **ignores calories** — calories are a function of the macros, so
counting them again would double-weight whichever macro is furthest off — and is **relative**, since
10 g short on a 20 g fat target is a worse miss than 10 g short on a 200 g carb target.

## Scaling moved server-side

`applyToAllVariants` scaled on the client, which would have skipped the top-up entirely for the
saved-meal path. The edit sheet now sends **unscaled** ingredients with `scaleToTarget: true`, and
the route portions them against the meal's **own stored targets** — read server-side, not taken from
the request, so a client sending wrong targets cannot silently reprice a meal. `scaleToTarget` is
opt-in because a rename PATCHes the same route and must not spend an AI call.

That needed `getMealPlanMeal(mealId, userId)`, which joins back through the variant to the plan —
`meal_plan_meals` carries no `user_id`, so the meal id alone says nothing about who owns it.

## Verification

`tsc` clean · 0 lint errors · 17/17 custom checks · **451 files / 3,720 tests green** (9 new).

End-to-end through the real route and the real model: the ice cream (milk + whey) into the plan's
carb-heaviest slot, target 644 kcal / 50P / 57C / 24F. It added **frozen banana 115 g** — a sensible
thing in protein ice cream — and returned **639 kcal / 50P / 57C / 24F**.

## Not exercised

- **Not verified on device.** No local-store path (all server round-trips), but the flow itself is
  unverified on the S25.
- **Plan generation is now slower when a meal needs topping up** — one extra model call per short
  meal, in parallel across meals. Not measured under a slow connection.
- No migration, no schema change, no sync-path change.
