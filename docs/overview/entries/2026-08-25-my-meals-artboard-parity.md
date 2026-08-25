# 2026-08-25 — My Meals takes artboard 3's shape, and the row's actions move to a swipe

**Branch:** `feat/my-meals-artboard-parity` · **Entry:** BF-29 · **Lane:** B

## What changed

The meal library was a stack of tall cards. Each carried its own border, a macro split bar, a
totals line and a four-button action row, and the calorie figure — the one number the list is
scanned for — sat in a pill inside the name block, at a different x on every row. Artboard 3 draws
a list: a count line, one grouped card of compact rows, `name · what is in it · calories in a
right-hand column · chevron`, and a footnote.

- `components/nutrition/saved-meals-sheet.tsx` — a `N meals` count line replaced the `· N` that
  used to ride on the sheet's title; the two full-width `Select` / `New Meal` bars became
  right-aligned pills; the search field lost its "more than four meals" gate and took the
  artboard's wording; the cards moved inside one `rounded-2xl` grouped container; the per-portion
  footnote is new.
- `components/nutrition/saved-meal-card.tsx` — collapsed to the row shape `food-row.tsx` settled
  on, with the macro split and the action row moved inside the expansion.
- `components/ui/swipe-actions.tsx` + `swipe-actions-math.ts` (new) — swipe-left-to-reveal, built
  on `@use-gesture/react` rather than hand-rolled, axis-locked to x with `touch-action: pan-y` so
  a vertical scroll is never captured. The commit decision (open, spring back, flick) is a pure
  module with 11 unit tests.
- `e2e/my-meals-artboard-parity.spec.ts` (new) — three specs; `e2e/fixtures.ts` gained
  `expandSavedMeal`, and four existing specs use it.

## What was found, and what it cost

**The footnote was the entry's real content, and half of it was a behaviour change.** "Calories are
per portion" was already true — `saved-meal-card.tsx` divides by `servings` and says so in its own
comment. "Swipe a row for label, edit and delete" was not: those three were buttons. The spec's
fixture is a two-portion meal totalling 320 kcal precisely so the assertion that the row reads
**160** cannot pass against a row that prints the batch.

**Swipe is an accelerator here, not the only route, and that is a deliberate divergence from the
drawing.** Artboard 3's row carries no buttons because artboard 4 — the meal detail screen — holds
them, and that screen does not exist yet (BF-30 owns the decision of whether it should). Deleting
the button row now would have put `Log this meal`, the ingredient breakdown, the macro split and
delete behind a horizontal drag and nothing else. So the expansion keeps all four, the tray offers
the three the footnote names, and one of the new specs asserts exactly that overlap.

**The tray is `aria-hidden` and unfocusable while closed.** A row that leaves three buttons in the
accessibility tree turns a twenty-meal list into sixty stops for a screen reader.

## Divergences from artboard 3, with reasons

| Drawn | Shipped | Why |
|---|---|---|
| `[back] My Meals [+ New]` in one header band | Title row, then a pill row | The sheet's close ✕ is `absolute top-4 right-4` and owns that corner; the drawing is a full screen with a back chevron, not a bottom sheet |
| Title reads `My Meals` | Still `Saved Meals` | Q-395c merges this list with My Foods under **one** name and has not shipped. BF-29's own entry says not to entrench a name that sweep will have to redo |
| 36 px `+ New` pill | 44 px | The tap-target floor wins over the drawing |
| `ChevronRight` on each row | Rotating `ChevronDown` | The row expands in place; a right chevron would promise a navigation that does not happen. It follows BF-30's decision, not this one |
| 40 px thumbnail per row | None | Q-406 owns the shared row's thumbnail and deliberately has not built it — BF-29's entry routes it there |
| No `Select` control | `Select` pill kept | Bulk delete is a shipped feature and the artboard simply does not draw it |

**One behaviour change worth the owner's eye:** logging a meal from this list is now two taps
(open the row, then `Log this meal`) rather than one. That is what the drawing specifies — artboard
3's row navigates, artboard 4 logs — but this sheet is often opened *from a meal slot in order to
log*, so if the extra tap grates, say so and the primary action comes back onto the row.

## Order found

**Q-395c had not shipped** — it sits at #5 in READY with its unpark PR (#458) still open. So this is
parity work on the un-merged screen, and the rename was left entirely alone.

## Not verified

- **Device.** The swipe is a new gesture on the canonical runtime and has not been on the S25. The
  web harness proves the handler fires from real touch events (CDP `Input.dispatchTouchEvent`), not
  that it coexists with the WebView's own scroll physics. Known-Issues row added.
- `e2e/meal-label.spec.ts`'s first test exceeds its 180 s timeout in this sandbox **on unmodified
  `main` as well** — six canvas styles and four zxing decodes under `pnpm dev`. Confirmed by
  stashing the branch and re-running. Not caused here, and not a required check.

## Gates run

`pnpm check:rules` — **Ran 57 of 57**. Unit suite 594 files / 4,888 tests. Nutrition e2e green apart
from the pre-existing timeout above.
