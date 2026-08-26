# Q-395c — Log Food becomes one screen, and one list gets one name

**Written:** 2026-08-26 · **Lane:** B · **Splits into:** Q-395c-1, Q-395c-2

Q-395c was one entry describing two changes that cannot ship together and cannot ship in the
order the entry implies. This plan says why, and what each half is.

## The finding that forces the split

**The two lists hold different entity types, and the entry does not say so.**

- `FoodLibrarySheet` (127 lines) searches **`food_items`** — a single food with macros and a serving
  size. Tapping one **adds it**.
- `SavedMealsSheet` (753 lines) lists **`saved_meals`** — a recipe with ingredients, a servings
  count, a photo and a printable label. Tapping one **opens the meal's own screen** (BF-30).

So *"Saved meals and My Foods become one list"* is not a rename over a shared shape. It is **one list
over two sources**, with two row shapes and two tap behaviours. The owner's complaint — *"So im
picking up a discrepancy between My Meals and My foods? Whats the difference"* — is about the naming
a user sees, and they are right that the distinction should not be theirs to hold. But the merge
still has to decide, per row, which of two things it is.

## Why the rename cannot go first

The entry is explicit that the rename is swept **in one pass** — *"a surface left on the old name
reads as a second list that is missing rows"*. That rules out shipping the rename alone: renaming
both lists to one name **while they are still two lists** is strictly worse than today, because the
user then has two lists with the same name. **The rename must ride with the merge.**

Measured: 15 user-facing occurrences across 8 `.tsx` files. Small — it is the merge that is large.

## Q-395c-1 — one list, one name

Merge `FoodLibrarySheet` into the saved-meals list and rename in the same PR.

- **One list over two sources**, ordered most-recently-used first so the merge does not bury saved
  meals (the entry's own requirement).
- **Row shape per kind.** A food is the shared `FoodRow`. A meal is the row BF-29 shipped — tile,
  name, `N items · makes M portions`, calories, chevron — and keeps its swipe tray.
- **Tap does what the kind does.** A food adds; a meal opens `meal-detail-sheet.tsx`. Do not
  flatten these into one behaviour to make the list uniform: adding a five-ingredient recipe with
  one tap and no portion choice is a data-entry bug, not a shortcut.
- **Diff the two sheets before merging** and carry every action across — bulk delete, meal-plan
  linkage (`usePlanSavedMealIds`), the label path — or say in the PR which was dropped and why.
- **`My Foods` rows carry P/C/F beside the calorie column.** ⚠ **This is the same question Q-406 is
  parked on**: it wants the shared row to grow a per-screen column, which is the slot Q-406 rules
  out. Either it resolves with Q-406's gate or this half ships without the split. Do not add the
  prop unilaterally.
- **Verification:** a grep proving nothing user-facing says *Saved meals* or *My Meals*; e2e that
  one list shows both a food and a meal, that each tap does its own thing, and that bulk delete and
  the label path still work.

## Q-395c-2 — the capture screen

`capture-step.tsx` (347 lines) collapses six tiles to one screen: search across everything, two tabs
(`Recent`, `My Foods`), and an action row (`Photo · Barcode · Describe or enter`).

- **`Needs:` Q-395c-1** — the `My Foods` tab is the merged list. Building the tab first means
  building it twice.
- **Two tabs, not four.** Artboard 2 draws `Recent · Frequent · My meals · Recipes`; the owner
  decided two, and where the drawing and the owner disagree the owner wins. `Frequent` was a second
  ordering of what `Recent` already shows.
- **One action row, not two.** The artboard's `Multi-add` / `Create food` is the same idea as the
  decided `Photo · Barcode · Describe or enter` under different labels. Reconcile to the decided
  set; do not ship both rows.
- **Describe and manual entry are one sheet** with the fields always visible, so neither is a hidden
  mode.
- ⚠ **A coordinate tap that misses a capture tile opens its neighbour**, and `History` opens a
  dialog with its own textbox that looks plausibly like the describe field — an e2e spec filled the
  wrong box and failed three assertions later (LA-30). Whatever replaces the grid, have the spec
  wait for the destination's own copy before touching it.

## Two things found while starting it, both of which change the shape

**1. A food's tap destination lives in the other half.** `FoodLibrarySheet`'s `onSelect` runs
`handleLibrarySelect` → `pushStep('assign')`: tapping a food does **not** log it, it goes to the
assign step to pick a meal type and a quantity. That step exists only inside `FoodLoggerSheet`. A
saved meal's tap opens `meal-detail-sheet.tsx`, which `SavedMealsSheet` owns. So the merged list has
two tap destinations that currently live in two different parents, and `/nutrition`'s **Saved Meals**
button opens `SavedMealsSheet` directly — where a food tap would have nowhere to go.

**Decided: the merged list lives in `FoodLoggerSheet`**, the only parent where both destinations
exist, and `/nutrition`'s Saved Meals button opens the food logger onto it. Reversal is moving one
component back and restoring one call site. The alternative — logging a food at one serving straight
from the list when no assign step is available — was rejected because the same row would then behave
differently depending on which button opened the sheet, which is the confusion this entry exists to
end.

**2. "Most-recently-used" is not available, and cannot be without a schema change.** `food_logs`
carries **no `saved_meal_id`** — logging a saved meal writes individual food rows and leaves no
record of which meal produced them, so **a saved meal has no last-used timestamp at all**. (The
`saved_meal_id` that does exist is on `meal_plan_meals`, which is plan linkage, not a log.)
`searchFoodItems` orders by `createdAt DESC, limit 20`.

**So order both by `createdAt DESC`** — the only recency signal the two entities share — and say so.
It still serves the requirement's stated purpose, *"so the merge does not bury saved meals"*, because
a newly-saved meal sorts to the top. **True MRU needs `food_logs.saved_meal_id`, which is Lane A's**
and should be filed separately if the ordering turns out to matter in use.

## Not decided here

Whether the merged list keeps two row shapes forever, or whether a saved meal eventually renders as
a food row with an ingredient count. That is a design question for after the owner has used the
merged list, and pre-deciding it would fix the answer before there is any evidence.
