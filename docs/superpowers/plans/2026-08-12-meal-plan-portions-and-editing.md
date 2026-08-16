# Meal plan: batch servings, top-up, reorder and instructed edits

**Date:** 2026-08-12 · **Domain:** nutrition · **Backlog:** Q-207…Q-210
**Source:** four owner reports on the S25 during v1.290/v1.291 testing.

Four asks that turned out to be two problems and two features.

---

## The problem the owner found

> *"I can create a large meal but I can't indicate portion sizes — this ice cream is 2 servings but
> there's nowhere to say that, so in the meal plan it added it as a full meal."*
>
> *"Say the meal plan chooses the half serving of ice cream — will it add other items to fill macros
> or will it do whole saved meals only? That could be a flaw."*

Both halves are real, and the second is worse than suspected. Read against the code:

`savedMealToIngredients()` (`packages/shared/src/nutrition/saved-meal-ingredients.ts`) converts a
library meal's **existing items** into plan ingredients. `scaleIngredientsToTargets()`
(`meal-split.ts`) then resizes **those items only**, each ingredient group clamped to 0.4×–2.5×.
**Nothing is ever added.**

Worked through with the owner's actual meal — Ninja Creami, 416 kcal at 63P/15C/11F — dropped into a
618 kcal / 38P / **83C** / 15F slot:

| | has | needs | can scaling get there? |
|---|---|---|---|
| protein | 63 g | 38 g | yes — 0.60× |
| carbs | 15 g | 83 g | **no, at any factor** |

**Corrected 2026-08-12 while implementing D2 — the first version of this table said "6.3×, and the
clamp stops at 2.5×". That is wrong, and the truth is worse.** Full cream milk is 31 kcal of fat
against 18 of carbohydrate per 100 g, and its protein share is 22% — under
`PROTEIN_SHARE_THRESHOLD` — so `dominantMacro` files it under **fat**. Whey is protein. The meal has
**no carb source at all**: the carb group is empty and no factor moves carbohydrate. Measured —
doubling the carb target to 166 g changes the result by nothing.

This matters for the fix, not just the write-up: widening the clamp would not have helped *even
slightly*. It is the same class already recorded in the domain README — *"a meal with no source for
a macro cannot reach that macro's target, however it is resized"* — and the saved-meal path walks
into it constantly, because a real saved meal is a finished dish rather than a balanced slot.

---

## Decisions

### D1 — A saved meal declares how many servings it makes; the plan takes one serving

`saved_meals` gains `servings` (default `1`). `savedMealToIngredients()` divides each weight by it,
so a 2-serving ice cream enters a plan as one portion.

**Rejected:** letting the plan pick a fractional amount of the whole meal. The scaler already does
fractional scaling and it is not the problem — the problem is that the *recipe* is a batch and
nothing said so. A serving count is a property of the meal, not a decision the plan makes each time.

**Consequence to be deliberate about:** "Log this meal" then logs **one serving**, not the batch.
That is the correct reading of the field and it is what the owner asked for, but it silently changes
what the button does for any meal whose count is raised. Existing meals default to `1`, so nothing
changes until the user sets it. The card labels it (`Makes 2 servings · per serving`) so the number
on screen and the number logged always agree.

### D2 — When a meal cannot reach its target by scaling, the plan tops it up with real food

After `scaleIngredientsToTargets()`, compute `mealFit()`. If any macro is still outside tolerance
and the shortfall is *upward* (the meal is too small in that macro), ask the model for **top-up
ingredients only** — then re-scale the combined list.

**Why the model rather than a lookup table.** A built-in filler list ("rice for carbs, olive oil for
fat") cannot see the user's dietary restrictions, their stores, or what the meal actually is —
adding rice to an ice cream is worse than the gap. The generator already holds all of that context
and already returns this exact ingredient shape.

**Rejected:** widening the 0.4×–2.5× clamp — and once the mechanism above was measured, it turned
out this would not have worked at all rather than merely being crude. The clamp also stops a plan
telling someone to eat 400 g of feta. The gap is a missing *food*, not a missing multiplier.

**Bounded on purpose:** top-up runs at most once per meal, adds at most 3 ingredients, and only when
the shortfall exceeds `mealFit()`'s tolerance. If the call fails, the meal keeps its honest gap —
the drift is displayed, never papered over, exactly as today.

**And the acceptance test is "meaningfully better", not "better".** Measured: adding 40 g of celery
to that ice cream improves the fit by 0.4%, so a bare better-or-not comparison would put celery in
an ice cream. `TOP_UP_MIN_IMPROVEMENT` (10%) is what makes fewer ingredients win a close call.

### D3 — Reordering re-splits the day rather than swapping labels

Moving a meal earlier or later changes **which slot it occupies**, and slots are not
interchangeable: `splitMacrosAcrossMeals()` weights carbs toward the meals bracketing training and
fat away from the pre-workout meal. So a reorder re-runs the split over the new order and re-scales
each meal to its new target — no new maths, both functions already exist.

**Up/down buttons, not drag.** The list is 1–6 items on a 6.9" screen; drag-reorder in this codebase
has a documented history of WebView trouble (persist synchronously inside the handler, `onDragOver`
not `onDragEnd`, gesture capture fighting the scroll container). Two 44px buttons have none of that
and are faster to hit one-handed.

### D4 — The instructed edit is a rewrite of one meal, not a chat

A text box on a plan meal — *"make this vegetarian"*, *"swap the quinoa for rice"* — posts the
current meal plus the instruction and gets one revised meal back, then scales it like any other.

**It reuses `generate/meal`'s contract deliberately.** Same request shape, same response schema, same
allergy handling (restrictions read from the DB, never the request body), same rate limit family. The
instruction is one more field, not a new pipeline. A conversational editor would need history, and
the thing being edited is a six-field object the user can already see.

**No claim of correctness.** The rewritten meal goes through the same review surface with its
ingredients visible beside the must-not-contain list. An instruction like "make this vegetarian" is
steering, not a guarantee, and nothing in the UI may say otherwise.

---

## Slices

Each is independently shippable and independently useful.

| # | Slice | Schema | Notes |
|---|---|---|---|
| A | Saved-meal servings (D1) | mig 182, local v25 | The only one touching sync. Ships alone. |
| B | Instructed meal edit (D4) | none | One route field + one UI control. |
| C | Reorder plan meals (D3) | none | Reuses `structure`'s re-split. |
| D | Plan top-up (D2) | none | Highest risk: a second AI call inside generation. |

### A — servings

1. `182_saved_meal_servings.sql`: `ALTER TABLE saved_meals ADD COLUMN IF NOT EXISTS servings DOUBLE PRECISION NOT NULL DEFAULT 1;`
2. `183_claude_ro_views_saved_meal_servings.sql` — regenerate with
   `CLAUDE_RO_OWNER_USER_ID=fe481797-4114-4f59-824d-223e0281823e`, into a **new** number.
3. Drizzle schema + `SavedMeal` type + `rowToSavedMeal` + the create/update paths.
4. Local SQLite **v25**: `ALTER TABLE` *and* the `CREATE TABLE` body *and* `RECONCILE_COLUMNS` —
   all three, per the local-migration rule.
5. Sync: `getSyncDelta` → `pullDelta` → `applyDelta`, plus the `pushMutations` branch mirroring the
   web route.
6. UI: a servings field in the builder; the card shows per-serving macros when `servings > 1`.
7. `savedMealToIngredients()` divides by `servings`; `logMealItems` logs one serving.

### B — instructed edit

`POST /api/nutrition/meal-plans/generate/meal` gains an optional `instruction` (≤200 chars) and a
`currentMeal`. When present the prompt becomes "rewrite this meal following the instruction", keeping
the same targets and the same avoid-list. UI: a text input under each meal on the review and edit
sheets.

### C — reorder

`PATCH /api/nutrition/meal-plans/[id]/structure` already re-splits and re-scales — it gains an
`order` field (an array of meal ids). Up/down buttons on `meal-plan-edit-sheet.tsx`.

### D — top-up

In `generate/route.ts` and `generate/meal/route.ts`, after scaling: `mealFit()` → if short, one
`generateObject` call for ≤3 top-up ingredients → merge → re-scale → keep whichever result fits
better, so a bad top-up can never make a meal worse.

---

## What must not regress

- **No allergen claim, anywhere.** D4's instruction and D2's top-up both go through the model. The
  review step shows ingredients beside the must-not-contain list and says the plan was written by AI.
- **Restrictions come from the DB, never the request body** — the existing `generate/meal` rule.
- **The clamp stays at 0.4×–2.5×.**
- **`servings` defaults to 1** so every existing saved meal behaves exactly as it does today.
- **Drift is displayed, never hidden.** If top-up fails or is not enough, `MealMacroBars` shows the
  gap as it does now.

## Not exercised by any of this

Native SQLite (slice A's v25 upgrade is the risk: a device holding v24 must survive the `ALTER`),
safe-area, and Samsung's renderer. Slice A needs the device smoke run or a Known-Issues row.
