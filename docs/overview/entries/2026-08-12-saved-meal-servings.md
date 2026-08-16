# 2026-08-12 — A saved meal can be a batch

**Release:** v1.292.0 · **Domain:** nutrition · **Branch:** `feat/saved-meal-servings`
**Plan:** [`superpowers/plans/2026-08-12-meal-plan-portions-and-editing.md`](../../superpowers/plans/2026-08-12-meal-plan-portions-and-editing.md) — slice A of four.

Owner report from the S25:

> *"I can create a large meal but I can't indicate portion sizes — this ice cream is 2 servings but
> there's nowhere to say that, so in the meal plan it added it as a full meal."*

## What shipped

`saved_meals.servings` (migration 182, default `1`). The builder gains a **Makes N servings**
control; the card shows one portion's macros when the count is above 1; `logMealItems` logs one
portion; `savedMealToIngredients` puts one portion into a meal-plan slot.

**`totals` deliberately stays the whole recipe.** Dividing it in `listSavedMeals` would silently
change what every existing caller means. One shared function — `oneServingItems()` in
`packages/shared/src/nutrition/saved-meal-ingredients.ts` — does the division, and both consumers
call it. A meal that makes one serving is returned untouched, so nothing that predates the field
changes behaviour.

## The three-part local migration, again

Local SQLite **v25**. The rule this project has died on twice is that a column needs *all three*:

- the `ALTER` in the v25 `statements`, for a device already holding `saved_meals`;
- the column in the `CREATE TABLE IF NOT EXISTS` body, for fresh installs — which reaches **only**
  fresh installs, because `CREATE TABLE IF NOT EXISTS` is a no-op on a device that has the table;
- the `RECONCILE_COLUMNS` row, which is the real authority after a half-applied upgrade.

`DEFAULT 1` is the load-bearing part. Every saved meal that already exists gets this column with no
value of its own, and anything other than 1 would silently change what "Log this meal" writes.

## Consequence stated on purpose

Raising a meal's count **changes what its Log button does** — it logs one portion, not the batch.
That is the correct reading and it is what was asked for, but it is a behaviour change on an
existing button, so the card labels it (`Makes 2 servings` / `per serving`) and the builder says so
in words. The number on screen and the number logged always agree.

## Verification

`tsc` clean · 0 lint errors · 17/17 custom checks · **450 files / 3,711 tests green**.

Twelve new tests. Six unit (`oneServingItems`: unchanged at 1, divides at 2 and 4, treats 0 /
negative / undefined as 1, does not mutate the input) and six against a real Postgres — including
**a row inserted without naming the column at all**, which is how every production row will acquire
it, and **a cross-user update refusal**, since `writeSavedMeal` is the single write path both the web
routes and the offline outbox replay funnel through.

Exercised live against `pnpm dev`: created a 2-serving meal through the API, read it back at
`servings: 2` with whole-recipe totals of 774 kcal, and confirmed the card renders **387 kcal · per
serving**. Existing meals came back at `servings: 1`.

`183_claude_ro_views_saved_meal_servings.sql` regenerated against the production owner id into a new
migration number; diffed against 181 — the only change is `servings` on the `saved_meals` view, same
79 views.

## Not exercised

- **Not verified on device, and this one has real device risk.** The v25 `ALTER` runs on a phone
  holding a v24 database; native SQLite does not exist in the sandbox, so that upgrade has never
  run. Known-Issues row added.
- Offline create/edit of a batch meal, and the cross-device pull of `servings`, are both
  APK-only paths.

## Still to come from the same plan

Slices B (instructed meal edit), C (reorder plan meals) and D (plan top-up when a meal cannot reach
its target by scaling) — D is the one that answers the owner's second question, that the plan
currently scales a saved meal and never adds anything to it.
