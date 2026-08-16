# 2026-08-11 — Meal Plan: a saved plan you can actually edit, built around meals you already eat (Q-192, Q-193)

**Branch:** `feat/meal-plan-edit-saved-meals` · **Domain:** `nutrition`
**Follows:** [`2026-08-11-meal-plan-portions-and-controls.md`](2026-08-11-meal-plan-portions-and-controls.md)

Two reports from the owner, on device, one session apart:

> there is still no option to edit meals in a plan. say I want to swap the first meal for something
> else — I would need to remake the whole thing.

> no option in the meal creator to add your food meals/ideas as well. would be a good spot to let
> people merge their current diets etc.

Both land on the same missing piece, which is why they shipped together.

## Why per-meal reroll didn't work on a saved plan

The previous session added per-meal regenerate and it only worked during review. That looked like a
UI gap; it wasn't. **`meal_plan_meals` stored a name, four macro targets, and nothing else** — the
ingredient breakdown existed only in the unsaved draft and was discarded on save. There was nothing
to re-scale, replace or even display, so the button had nowhere to exist.

I had already filed this as Q-192 and left it, which was the wrong call: it was not a follow-up, it
was the blocker under the feature the owner had just been handed.

Migration **180** adds `ingredients JSONB` and `suggested_time TEXT`. A denormalised snapshot, not
rows joined to `food_items`, for the reason the offline rules already give: a local table of foreign
keys cannot render (the `food_logs` → `food_items` data-loss bug). It is also the honest shape for a
plan — it records what was prescribed, not what the library says today.

The snapshot uses the `NutritionIngredient` shape exactly, so `sumIngredients()` and
`scaleIngredientsToTargets()` apply with no conversion.

## Editing a saved plan

New `MealPlanEditSheet`, reached from Manage plan → **Edit meals**. Per meal: *Suggest another*
(AI), *My meals* (swap in something from your library), and rename. Each shows its ingredients and
its macro bars, with the day total above.

Every edit is applied to **all variants** at each variant's own targets. Writing it only into the
tab you were looking at would leave a training/rest plan holding two different meals in the same
slot.

Measured live: rerolled meal 2 of a saved 3-meal plan — it came back *Grilled Chicken and Quinoa
Power Bowl* at 551/537 kcal, 50/50 P, 58/57 C, 13/12 F, and re-reading the plan showed meals 1 and 3
untouched.

## Building a plan around what you already eat

New setup step 5, **Meals you already eat**, with two deliberately different affordances:

- **Keep meals from your library.** A saved meal has real ingredients, so it is kept verbatim and
  its portions are resized to its slot's target like any other meal. `savedMealToIngredients()`
  converts items → per-100g densities; going through densities rather than the item's own totals is
  what makes it resizable at all.
- **Meals you usually eat**, free text. No macros attached, so it can only steer the model. The copy
  says exactly that rather than implying the text is a recipe.

The generator asks for `mealCount − kept.length` meals and is told the kept ones are fixed. Kept
meals take the first slots so their position survives a reroll of the rest.

**At least one slot always stays open.** A plan of entirely fixed meals has nothing to generate and
would silently ignore the calorie target, so the picker caps selection at `mealCount − 1` and says
why.

Measured live with a kept "My usual oats" and the steer "eggs on sourdough with avocado": slot 0 was
the library meal resized (whey 30 g → 50 g to reach 50 g protein), slot 2 came back
*Post-training Eggs on Sourdough*, and both generated meals hit their targets exactly.

**A kept meal can miss its target and that is correct.** "My usual oats" has no fat source, so it
lands at 5 g against a 24 g target — visible in the bars. Silently rewriting a meal the user said
they already eat would defeat the point of keeping it.

## The two bugs this nearly shipped with

Both were caught by running the dev server rather than by reading the code.

1. **Migration 181 did not parse.** I generated the `claude_ro` views with `2>&1`, so the
   generator's stdout summary line (`[claude-ro] 79 views, …`) landed *inside* the SQL file.
   `ensureSchema` failed it on every boot with `syntax error at or near "["`. Regenerated with
   stderr discarded.
2. **It was scoped to the wrong user.** The generator takes `CLAUDE_RO_OWNER_USER_ID`, and I passed
   my local dev user. Migration 179 on `main` is scoped to the **production** owner
   (`fe481797-…`), so shipping mine would have pointed every `claude_ro` view at a user that does
   not exist in production and quietly broken the admin query endpoint. The regenerated file now
   diffs against 179 by exactly the two new columns and nothing else — that diff is the check worth
   repeating whenever this migration is regenerated.

## Offline

Local SQLite **v24** adds the two columns as ALTERs *and* to the `CREATE TABLE` body *and* to
`RECONCILE_COLUMNS`. All three are needed: the CREATE body alone reaches fresh installs only, which
is the exact trap `check-local-column-upgrade-path.js` exists to catch. `applyDelta` stringifies to
the TEXT mirror; the reader parses defensively, because a malformed row must cost its ingredient
list, not the whole screen.

## Verified / not verified

Full suite green, 17 custom rule checks, tsc and lint clean. Exercised live against the dev
database: a plan generated with a kept library meal and a free-text steer, saved with ingredients
intact, then one meal rerolled and PATCHed with the other two unchanged. Rendered at the 412×915 S25
viewport: the new setup step and the Edit meals sheet.

**Not verified on device.** No native SQLite in the sandbox, so the **v24 upgrade is unexercised** —
and unlike v23 this one is ALTER-based, so it is the migration most worth watching on a device that
already holds a v23 database. Safe-area insets read 0 here, so the two new sheets' bottom clearance
is also unverified. Known-Issues row added.
