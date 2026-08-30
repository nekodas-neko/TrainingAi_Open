# The quantity editor is Option A, and an ingredient stopped claiming servings (BF-46 ② ③)

**Branch:** `feat/meal-quantity-editor-option-a` · **Lane B**

Two things the owner settled from drawings at 412 dp on the app's own dark tokens. One component
carries both sheets — BF-26 converged the diary's and the builder's onto `quantity-editor.tsx` — so
this lands in both places at once.

## ③ Option A, and the one place the build departs from the drawing

The owner's sentence: *"the grams/serve could be smaller and to the right of the − x + button then
the other buttons could be enlarged and spread to match the width it has: more distinct macro and
total calorie buttons."* Moving the toggle out of its own full-width row is what frees that width;
everything else follows from it.

Top to bottom now: the serving line, the stepper with the unit toggle stacked in a narrow column to
its right, four presets in equal columns spanning the width, the calorie total alone at the largest
type on the sheet, then three macro tiles.

**The drawing puts the toggle at the stepper's height, and that is not buildable here.** Every
`button` in this app carries a 48 dp floor (`globals.css`, a rule with ten regressions behind it),
so a stacked two-option toggle is **96 px** and cannot shrink to meet a 56 px stepper. The escape
hatch is `.tap-dense`, which the CSS reserves for inline text buttons — a unit toggle is a real
control and taking it below the floor would be the exact thing `touch-target-size.spec.ts` exists to
catch. **So the stepper grew to 96 px instead**, which the drawing's own intent supports: the value
is meant to be the tallest, heaviest thing there. A food with no serving size has no toggle at all
and keeps the short row.

`SegmentedTabs` gained `orientation="vertical"` rather than a second copy of the same two buttons —
it is the primitive eight call sites already use, and the floor it applies per segment is exactly
what made the height decision above.

The macros are **named** — Protein · Carbs · Fat — not `P`/`C`/`F`. That is what the drawing shows,
and it takes colour off being the only thing carrying the meaning, which the colour-only-state rule
asks for anyway. BF-26's earned constraints are kept: the macro colours stay, and the grams chip is
still hidden when there is no serving size to divide by.

## ② A serving inside a serving

A row read `8 servings · 1000 g` while the meal it belongs to is measured in *portions*, so
"serving" meant two different things one line apart. The owner: *"just the weight would be fine for
the meals. Only portions are really needed when making serving sizes for the meals."*

The rule moved to `ingredientAmountLabel` in `saved-meal-qty.ts` — out of the hook, so it is
testable in `node` at all, which is the same reason `qtyFromInput` and `steppedQty` already live
there. It takes no unit any more: a parameter it ignored would read as a switch that still works.

**Servings survive for a food with no serving size**, which has no gram equivalent to show instead.
That is the one case where the word is the only thing available rather than a competing unit.

## Verification

`e2e/quantity-editor-option-a.spec.ts`, two tests. The first asserts an ingredient row carries
`1000 g` and does not match `/serving/i` at all. The second drives the sheet and asserts the macro
names, the calorie total standing alone, and — the part that matters — the toggle's **geometry**:
its left edge past the stepper's right edge, its top above the stepper's bottom, and both segments
at ≥ 48 px. "Beside the stepper" is the whole of the owner's request and is invisible to a
text-only check; the same two buttons in a row above would satisfy every other assertion.

**Proved both ways, twice.** Putting the toggle back in a full-width row below fails the geometry
assertion by name; restoring the old label fails the row assertion by name.

**It was flaky first and the fix is worth carrying.** Three sheets open in sequence here, each
covering the control that opened it, so a tap that misses cannot simply be repeated. Each step now
retries against its own effect — and the marker for "the builder is open" had to be its `Update
Meal` button, **not** its `Ingredients` heading: the meal's detail sheet stays mounted underneath
and has a heading by that name, so the heading was already visible before Edit was tapped. A
precondition satisfied by the state it is meant to replace cannot fail, which is a shape this repo
has now hit three times. Three consecutive clean runs after.

Full unit suite **5,630 passed** / 671 files. `pnpm check:rules` — **Ran 62 of 62**. Typecheck and
lint clean.

## Not exercised

- **The S25, which is where a 96 px stepper is either right or too tall.** The sandbox renders at
  desktop width; the entry already warns Option A is the tallest of the three and may scroll on a
  long food name. If it does, tighten the gaps — **do not** merge the total and the macros back into
  one block, which is option B and a settled question.
- **Safe-area and the gesture bar.** Both sheets' footers are unchanged, but nothing here was seen
  on a device, and `env(safe-area-inset-*)` renders 0 in the sandbox.
- **BF-46 ①(a)**, the photo picker's placement, is untouched and stays queued. ①(b)'s root cause
  shipped separately (v1.400.0).
