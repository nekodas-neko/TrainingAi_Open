# 2026-08-26 — One food list: My Meals and the food library merge (Q-395c)

**PR:** `feat/one-food-list` · **v1.382.0** · **Lane B**

## What shipped

The owner's question was *"So im picking up a discrepancy between My Meals and My foods? Whats the
difference"*, and there wasn't one a user could hold: `My Meals` listed `saved_meals`, the library
listed `food_items`, and which list a thing was in came down to how it had been added.

They are **one list called My Foods** now, newest-first across both sources.
`components/nutrition/food-list.tsx` (new) is one list over **two sources**, not one shape over a
merged type — a food row opens the assign step, a meal row opens its own screen.
`food-library-sheet.tsx` is deleted, its search and local-first seed folded in. `/nutrition`'s button
opens the logger onto the list; `capture-step.tsx`'s `History` and `Saved Meals` tiles became one
`My Foods` tile. The rename swept 8 files — nothing user-facing says *Saved Meals* or *My Meals*.

## Two constraints, both measured rather than assumed

**MRU is unavailable.** `food_logs` carries no `saved_meal_id`, so a saved meal has **no last-used
timestamp at all**. `createdAt DESC` is the only recency signal the two sources share; it still keeps
a newly-saved meal off the bottom. True MRU needs a column that does not exist — Lane A's to add.

**The list had to live in the logger**, because a food's tap needs the assign step and that step is
`FoodLoggerSheet`'s. `handleLibrarySelect` closes the list first — without that the assign step
renders *behind* the list sheet. `saved-meals-sheet.tsx` was 753 lines against the hard 800-line
ceiling, so the list was extracted rather than appended; it is 696 now.

## The bug this uncovered: back-dismiss was wrong at three layers (LB-17)

Log Food → My Foods → a meal is the app's first three-deep nest, and one back press closed **two**
layers. `useSheetBackDismiss` decided "my entry is gone" by comparing the arriving state's `sheetId`
against its own, so every sheet that was not the one we landed on closed itself. At two layers that
is right by accident — back from the top lands on the only other sheet's entry, with nothing under it
to be wrong about. At three, it lands on the **middle** sheet's entry and the **bottom** sheet reads
a foreign id and closes, taking the middle one with it because it renders inside it.

"Gone" has to be a **depth**, not an id mismatch: each entry now carries the depth it was pushed at,
and a sheet closes only when it arrives at something shallower than itself. The page is depth 0, so a
lone sheet still closes on back.

Found by instrumenting `pushState`/`back`/`popstate` in the browser, not by reading — the Playwright
symptom was `element was detached from the DOM` on a button just asserted visible, which reads as an
animation-timing problem and is not one.

**Regression test:** `back-dismiss-sweep.spec.ts` — *back unwinds a three-layer nest one press at a
time*, asserting press-by-press on what is on screen. It cannot count dialogs: Radix aria-hides every
covered layer, so `getByRole('dialog')` sees one whatever the depth is, and a collapse looks
identical to a correct unwind. Verified by reverting the fix: the new test fails, the rest pass.

## Not exercised

- **No device run.** Pure UI on the canonical runtime, and the nest is a **new three-layer unwind on
  the real back gesture** — the sandbox models that and does not prove it.
- Safe-area insets render as 0 here; the nest's unwind was never watched against a gesture bar.
- Samsung's WebView compositor has not been shown one scroller interleaving meal rows carrying
  data-URI tiles with plain food rows.

## Files

`food-list.tsx` (new) · `saved-meals-sheet.tsx` (753 → 696) · `food-library-sheet.tsx` (deleted) ·
`food-logger-sheet.tsx` · `capture-step.tsx` · `nutrition-content.tsx` ·
`lib/hooks/use-sheet-back-dismiss.ts` · the rename across `nutrition-action-row.tsx`,
`meal-plan-edit-sheet.tsx`, `meal-plan-section.tsx`, `plan-meal-row.tsx`, `my-meals-picker.tsx`,
`use-plan-meal-saving.ts`.
