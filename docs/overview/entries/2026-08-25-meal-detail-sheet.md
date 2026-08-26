# 2026-08-25 — a saved meal gets its own screen

**Branch:** `feat/meal-detail-sheet` · **Entry:** BF-30 · **Lane:** B

## The decision BF-30 asked for

> *"The first task is to decide whether Meal detail is a new route, a full-height sheet, or an
> expansion of the card, and that decision belongs in the PR before any markup."*

**A nested full-height sheet** — `components/nutrition/meal-detail-sheet.tsx`, stacked over the
library. Three reasons, in the order they decided it:

1. **The content is a screen's worth.** A hero, three macro columns carrying percentage *and* grams
   *and* a label, a five-row ingredient list and a bottom action row do not fit inside one row of a
   list whose whole point (BF-29, shipped hours earlier) is being scannable. Keeping it as an
   expansion would have undone that.
2. **A route would fight the surface it opens from.** The library is a bottom sheet over
   `/nutrition`; navigating away would dismiss it and returning would have to re-open it. Stacked
   sheets are what this app already does — `MealLabelSheet` opens from this very list — and
   `back-dismiss.tsx` (BF-27) already closes exactly one layer per back press.
3. **It resolves a duplication BF-29 knowingly left.** Label, edit and delete sat in *two* places
   because the swipe tray needed a non-gesture counterpart and there was nowhere else to put one.
   Now they live in the meal, and the swipe is an accelerator with nothing unique behind it.

Reversal cost is low: the sheet is one component and one piece of state on the list.

## What changed

- `meal-detail-sheet.tsx` (new) — artboard 4: back, photo, name with `Makes 2 portions · 5
  ingredients`, the per-portion figure, three macro columns, the whole-batch ingredient list, and
  `Log this meal` with its icon buttons.
- `saved-meal-card.tsx` — 258 → 124 lines. A pure row now; the expansion is gone and **the chevron
  points right**, which BF-29 recorded as a deliberate divergence to be resolved by this decision.
- `saved-meal-totals.ts` (new) — `portionRows` / `batchRows` / `sumRows`. The row and the detail both
  need the same arithmetic on the same meal at two scopes; one copy, not two.
- `saved-meals-sheet.tsx` — holds `detailMeal`, mounted once rather than per row.

## The two scopes are the point, and they are both labelled

The headline figure and the macro columns are **one portion** — what `Log this meal` writes. The
ingredient list is the **whole batch** — the recipe you actually cook. Artboard 4 draws that split
deliberately and labels both halves; it is not an inconsistency waiting to be tidied. The e2e fixture
is built so they cannot be conflated: a two-portion meal of 200 kcal oats + 120 kcal whey, so the
headline must read **160** while the rows beneath read **200** and **120**. Any implementation that
picks one scope for the whole screen fails on one number or the other.

## A regression this introduced and caught

Moving the actions out of the card left the swipe tray's `Delete` wired straight to the delete
handler — **one thumb-flick from a scroll, deleting a meal with no confirmation**. BF-29's own spec
caught it. The fix routes the tray into the meal with its confirmation already up, so you see what
you are about to delete, and it is why `confirmingDelete` is a controlled prop rather than local
state: one confirmation UI, not a second copy on the row.

## Divergences from artboard 4, with reasons

| Drawn | Shipped | Why |
|---|---|---|
| Delete behind a hero overflow menu | A fourth button in the action row | The app has no dropdown-menu primitive; inventing one for a single call site is a worse trade. All four buttons still clear the 48 dp floor |
| A `Photo` button in the hero | The photo if set; otherwise an "Add a photo" affordance that opens the builder | The builder already owns the picker and its size cap (Q-327). A second picker here is a second write path to one column |
| Back chevron in a hero band | Back chevron in the sheet header | It is a sheet, and `hideCloseButton` keeps one dismissal affordance rather than two |

## Gates

`pnpm check:rules` — **Ran 58 of 58**. New e2e 2 of 2; the dependent nutrition specs re-run green
after `expandSavedMeal` became `openSavedMeal` (four specs reach for actions that moved).

## Not verified

**Device.** The detail is a **nested** sheet over the library, so the back gesture now has three
layers to unwind (detail → library → screen) and BF-27's one-press-per-layer guarantee is what makes
that work — untested on the S25. Also unverified: that a 92vh sheet's action row clears the gesture
bar, and that the photo `<img>` at 40 vh does not push the ingredient list off-screen on a real meal
with ten ingredients.
