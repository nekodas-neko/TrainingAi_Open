# BF-52 — the entry point, and a test of mine that had run out of time

**Branch:** `feat/meal-builder-entry-point-bf52` · **Lane B** · v1.410.0

Built to [its own plan](../../superpowers/plans/2026-08-31-ai-meal-builder-entry-point.md), written
earlier the same day.

## What shipped

A `Recipe photo · Recipe link · Describe it` row in the builder, **above the collapsed ingredient
picker**. That placement is the entry: the three whole-meal inputs used to be *mutually exclusive
renders of one slot* inside a search field you had to open first, chosen by what you had typed — so
the URL option did not exist until you had already pasted the URL.

The engine is untouched. `/api/nutrition/scan` already took `{ image }`, `{ url }` and `{ text }` as
three branches of one handler, and `Describe it` is the third of those reaching the builder for the
first time.

## The instruction the plan declined, shipped as declined

BF-52 says to absorb BF-63's barcode button into the new row. It is not there. These three produce a
**whole ingredient list**; a barcode names **one product**, and under a heading reading *"start this
meal from"* it would promise to build a meal from a packet. It stays beside the ingredient search
with the AI estimate — the other thing that adds one ingredient.

## Two things found while building it

**The URL branch in the search slot stays, and not for convenience.** The plan implied taking both
old affordances out of that slot. Only the photo moved. Without the URL branch a pasted link falls
through to the estimate below — and `ingredient-search.tsx`'s own comment says what that does:
*"running an AI estimate over the text of a URL produces a food called 'https' with invented
macros"*. It is a guard as much as an affordance, and removing it would have reintroduced a known
bad outcome that no test covered.

**`runRecipeImport` came out of `ingredient-picker.tsx` and became testable.** Two callers meant it
could not stay a closure over one component's state. Its own comment said the multi-candidate
branch, the serial minting, the 0.01 floor and the `recipeYield` refusal *"took two entries to get
right"* — four behaviours defended by prose, because exercising them meant rendering a React
component and neither vitest project runs a DOM. They have ten tests now.

## A red e2e that was mine, and predated this branch

`meal-label.spec.ts` failed with a bare 180 s timeout. It failed on **clean `main`** too, so it was
not this change — it was the same spec I lengthened in #692 the same day, which passed in CI there
and sat marginal against its own budget. One test painted seven styles and decoded five.

Split: the share-code assertions are their own test now, with `openLabelSheet` and the style-settle
machinery lifted to module scope. Six tests, each with room, and a failure names which half broke.
**This is the marginal-timeout shape the repo already documents for the Oura rollup tests** — three
of those sat within 20% of the limit and any parallel load tipped them over. A test at its limit is a
test that will fail for reasons unrelated to the code.

## Verified

`tsc --noEmit` clean · `pnpm lint` **0 errors** · `pnpm check:rules` **Ran 65 of 65** · full
`npx vitest run` **692 files / 5,794 passed**, 3 files / 59 skipped · `meal-label` **6 passed**,
and `empty-meal-library` + `builder-barcode-scan` + `nutrition-sheet-surface` **7 passed**.

Every guard is **mutation-tested**, and one of them could not fail when first written: the 0.01-floor
test used a **0.5 g** ingredient, where `ingredientToEntry` already returns 0.01 and `Math.max` is a
no-op — it passed with the floor deleted. It uses **0.4 g** now, which the conversion takes to
exactly 0. Defaulting `recipeYield` to 1, removing the multi-candidate branch, removing the row from
the builder, and neutering the URL guard each fail their own test.

A source guard also matched its own explanatory comment for the **third time today** — a whole-file
grep for "barcode" hit the paragraph explaining why there is no barcode. The assertion slices past
the doc block now.

## Not exercised

- **The device.** *"Describe or enter"*-length labels wrap to two lines in a third of 412 dp; the
  tiles are padding-driven so they grow rather than clip, but whether three tiles plus an expanded
  input read well on the phone is a judgement the sandbox cannot make.
- **The recipe-photo picker on device.** Its Capacitor `CameraSource.Prompt` path is unchanged and
  its named file input is unchanged; only the chrome around it is new. Neither has been on the S25.
- **A multi-dish page through the new row.** The candidate branch is unit-tested and the row wires
  `onCandidates`, but no e2e drives a real two-recipe page.
