# The quantity sheet, and one row shape for every food (Q-395a)

**Branch:** `feat/quantity-sheet-collapsing-rows` · **Lane B** · v1.364.0

## What shipped

`components/nutrition/quantity-sheet.tsx` — editing one ingredient's amount, on its own screen.
`components/nutrition/ingredient-row.tsx` is **deleted**, and the meal builder's rows are the shared
`FoodRow` Q-406 shipped. `QtyUnit` moved to `saved-meal-qty.ts`, beside the maths that uses it.

This is finding 12 made real: **a row in a list carries no editor at all.** That is the only reason
one row component can serve the diary, the library, both search lists and now the builder — a row
with a stepper, a number field and a unit toggle inside it cannot be the same component as a row
that is just a name and a number.

## Three things the entry got slightly wrong, and what was done instead

**"`ingredient-row.tsx` becoming `food-row.tsx`" could not be followed literally** — `food-row.tsx`
already exists as Q-406's shipped component. The instruction beside it is the one that matters
(*"the collapsed shape IS Q-406's row — not a second component"*), so `ingredient-row.tsx` is gone
rather than renamed onto a live file.

**`Needs: Q-406` was stale.** Q-406's own text has said *"Q-395a's `Needs: Q-406` is satisfied"*
since 2026-08-23, but the field the tool reads still said otherwise, so this entry sat parked. Same
field-vs-prose gap as Q-306's, removed here.

**Q-395b's `Needs: Q-395a` is cleared too.** What phase 3 depends on is these components existing.
They do. Q-395a stays queued only for its device smoke run, and a device check on the builder does
not gate the day screen.

## The memo check earned its place

The first version passed `onPress={() => setEditingIngredientId(item.id)}` from inside a `.map()`,
which defeats `FoodRow`'s `memo()` silently. `check-memo-prop-stability.js` failed the build and
named the line. The fix is the pattern `ingredient-search.tsx` already keeps — a small memoised
wrapper taking scalars and a stable `useCallback` — not a hoist, because a hook cannot live in a
`.map()`.

## 48 dp, as one change rather than eight

`components/ui/segmented-tabs.tsx`: `min-h-11` → `min-h-12`, which lifts all **8** call sites at
once. The batch-size stepper and its field went 44 → 48 as well. Measured after: segments render at
exactly **48 px** on `/more` and `/health`, with no horizontal overflow on either.

## Verification

Driven in a browser at 412×915 against `pnpm dev` + local Postgres, through the real sheet, in
**both themes**:

| | |
|---|---|
| header | the meal's name over *"Makes 1 portion · 149 kcal each"* |
| collapsed row | *"Chicken pate · 1 serving · 48 g · 149 kcal ›"* — no editor |
| sheet header | *"INGREDIENT 1 OF 2 · Q395A PROBE MEAL"* |
| `2 srv` preset | 298 kcal (2 × 149) |
| srv → g | field showed 96 (2 × 48 g) |
| `+` step | 101 g |
| Done | row wrote back *"101 g · 313 kcal"*, totals followed |
| Remove | list emptied, sheet closed |
| edit an existing meal | saved (`POST` 201), reopened via **Edit** — header reads *"Edit path probe · Makes 1 portion · 149 kcal each"*, row collapsed, sheet opens with the right kicker |
| tapped-row highlight | **false → true → false** across open and Done |

Colours invert properly — light `oklch(1 0 0)` on `oklch(0.145 0 0)`, dark `oklch(0.05 0 0)` on
`oklch(0.985 0 0)` — so nothing is hardcoded. Zero page errors in either theme.

`tsc --noEmit` clean · `eslint` zero warnings introduced · `pnpm check:rules` **Ran 55 of 55** ·
`check-component-size`, `check-hex-literals`, `check-memo-prop-stability` all clean.

## Not exercised

**The device smoke run this entry names was not done, and a browser cannot stand in for it.** The
web sandbox renders safe-area insets as **0**, and `SheetContent side="bottom"` is what owns the
bottom inset — so the one thing most likely to be wrong on the S25 is exactly the thing this check
cannot see. That matters more than usual here because the sheet's action row now carries a
**destructive** control (Remove) beside Done.

**Only the library search path fed the sheet.** The Open Food Facts and AI-estimate paths were
exercised in BF-11a and are unchanged by this diff, but the ingredient this run edited came from the
local library.

Nothing checked on the S25.
