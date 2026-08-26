# 2026-08-26 — the meal builder keeps its numbers on screen

**Branch:** `feat/edit-meal-batch-footer` · **Entry:** BF-31 · **Lane:** B

## The entry named the wrong files, and both its open questions were already answered

**Shipped counterpart, corrected.** BF-31 named `assign-step.tsx`, `review-step.tsx` and
`ingredient-picker.tsx` as "the builder". The first two belong to `food-logger-sheet.tsx` — the
**scan / Log Food** flow — and neither is reachable from Edit Meal. The real counterpart is
`saved-meals-sheet.tsx`'s `tab === 'build'`. (`ingredient-picker.tsx` was right, and is rendered from
there.) The entry was corrected in place before this PR.

**Finding 1 — "does the builder show those numbers during editing, or only at a review step?"** It
already showed them, live, in a `bg-brand/10` card. So this is **not** a behaviour change. What was
wrong is *where*: the card sat inline in the ingredient list, so the moment you scrolled to the
ingredient you were editing, the numbers it changed were off screen. Artboard 5 pins them. That is
the difference between a screen and a list, and it is what the entry means by "the footer is the
finding".

**Finding 2 — "does renaming cost a separate sheet or step?"** No. The name was a labelled `<Input>`
in the body, always visible, and the `SheetTitle` already mirrored it with
`Makes N portions · X kcal each` beneath (Q-395a). Artboard 5 moves that input *into* the header
behind a pencil and drops the standalone field, which is what shipped.

## What changed

- **The pinned footer** — `Batch · 555 kcal · 66 P · 48 C · 13 F · … · 278 / portion`, above
  `Save meal`, outside the scroll. The macro letters take `MACRO_COLORS`; the artboard's own hex
  values *are* that palette, so parity and the token rule agree here rather than trading off.
- **The name is edited in place** from the header, behind a pencil. The standalone field is gone.
- **`Add ingredient` and `Add a photo` end the list**, as two affordances rather than a permanently
  open search and a tile at the top.

## The judgement calls

- **The picker expands in place, it does not become a sheet.** A sheet to add one ingredient would be
  a third layer over the library, and BF-30 just made the second one.
- **It starts open for a new meal and closed when editing.** Artboard 5 draws "Edit meal", where a
  collapsed affordance is right; an empty builder with a collapsed search is a dead end. So the
  default follows which of the two you are in.
- **The servings stepper stays, and the artboard does not draw it.** Artboard 5 shows no way to
  change the batch size while its own header says `Makes 2 portions`. An artboard is one screenful
  and a section absent from it is not thereby deleted (BF-28) — deleting the only control that sets
  the number the whole screen is about would be reading the drawing too literally.

## Gates

`pnpm check:rules` — **Ran 58 of 58**. e2e: the 2 new specs, plus the 9 that drive this builder
(photo picker, recipe import, plan-to-meal) green.

## Not verified

**Device.** The footer is a new bottom-anchored region inside a sheet — `SheetContent side="bottom"`
owns the bottom inset and must not be given `pb-safe*` of its own, which this respects, but that it
actually clears the gesture bar on the S25 is unchecked. Also unchecked: that the header's inline
input does not get covered by the software keyboard when the sheet is already 90vh.
