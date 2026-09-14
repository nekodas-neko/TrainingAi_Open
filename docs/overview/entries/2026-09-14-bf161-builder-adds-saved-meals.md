# 2026-09-14 — BF-161: the meal builder can add a saved meal, flattened

**Lane B.** Branch `fix/bf161-meal-builder-add-saved-meals`. v1.456.8.

## What was asked, and what the queue did with it

Owner: *"For the meal builder it should let you add meals/saved items as part of the meal builder."*

The builder's search had **three** sources — your own foods, an AI estimate, the food database — and
none of them was a meal. Log Food, one screen back in the same sheet, has had a `meals` tab since it
shipped; the capability existed and simply did not reach one screen deeper.

The entry framed a real decision rather than an implementation, and the owner answered it:
*"Okay lets go with flatten for now."*

## Why flattening is not a shortcut

`saved_meal_items.food_item_id` is **NOT NULL**. A meal item *is* a food item, so there is no column
a nested meal could occupy. Real nesting costs a migration, **recursive macro computation in every
consumer of `saved_meal_items`**, and cycle prevention (meal A contains B contains A) — a class of
bug with no cheap guard, for an account holding 15 saved meals averaging 1.9 items each.

**What it gives up, stated because it is a choice:** a meal built from a saved meal is a snapshot.
Editing the source later does not change it. Nothing on screen implies otherwise — there is
deliberately no *"from &lt;meal&gt;"* provenance chip, because that reads as a live link.

## Two things that made this smaller than it looked

- **No new fetch, no schema change.** `SavedMeal` already carries `items`, each with its `foodItem`
  and `quantityMultiplier`, and the sheet already loads them for its own list. The new source is
  therefore instant and works offline, like the own-foods source beside it.
- **The mapping already existed.** `openBuild` built the same `{ item, qty }` rows inline to load a
  meal for editing. Both now go through `savedMealToEntries`, which **settled the quantity question
  by agreement rather than argument**: editing an existing meal already loads at the stored
  whole-recipe multiplier, which is exactly what makes BF-161's own check — that the result matches
  the sum of the sources — true as written.

## Where the code went, and why not into the obvious file

`saved-meals-sheet.tsx` was **788 lines against a hard 800-line ceiling**, and the size rule is
explicit that a new feature goes into an extracted child rather than onto the hotspot. So the source
list is `saved-meal-results.tsx` and the arithmetic is `saved-meal-flatten.ts`; the sheet gained a
four-line handler and two props. It ends at **791**, net +3, because routing the recipe import
through the shared `addEntries` removed eight lines from it.

## Verified

- `pnpm check:rules` **Ran 74 of 74**, all passed · `tsc --noEmit` clean · `pnpm lint` 0 errors.
- `components/nutrition/__tests__/saved-meal-flatten.test.ts` — 7 tests, including a guard that **no
  nesting column appeared** alongside the flatten, since avoiding that migration is the decision.
- `e2e/bf161-builder-adds-saved-meals.spec.ts` — reachability, which the unit test cannot cover: a
  source that exists and cannot be reached from the builder is the exact bug being fixed.

**Two spec failures worth recording, both mine and neither in the feature.** The first version used
`.click()` and timed out on the Nutrition screen without opening the sheet — `.click()` never lands
there (Q-354), a trap already written down in this repo and hit earlier the same day. The fix was to
take `builder-barcode-scan.spec.ts`'s opener verbatim rather than write a new one; it reaches the
same ingredient search for the same reason. The second was a strict-mode violation on
`getByText('Your meals')`, which matches **both** the tab and the list heading — the match being
ambiguous was the render working, which is a confusing way to read a red run.

## Not exercised

**The device.** `Keep:` on the entry: on the S25, build a meal from two saved meals and confirm the
ingredient rows, their quantities and the macro total match the sum of the sources. Recorded in
`projectOverview.md` as not device-verified.
