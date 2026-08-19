# 2026-08-19 — the default label printed none of the ingredient list it promised (Q-399)

Lane B. v1.325.0. Two component files, one test file, one E2E assertion, one follow-up filed.

## What the owner saw

*"I dont see the B2 default we wanted… where is my b2 default? should of shipped?"* — against
v1.324.6, with the style selected. It **had** shipped (Q-397, #105), it **was** the default, and it
**was** correctly selected. It simply drew no ingredients, which is the one thing that style exists
to do.

## The arithmetic, confirmed

`drawSquareCentredLabel` walks the column top-down and then asks how many 8-unit lines fit above the
code. At the shipped geometry:

```
L = (189 − 137) / 2 = 26          bottom = 163
y = 30 + nameSize(12) + 7 + caloriesSize(21) + 6 + macroSize(7.5) + 5 + rule gap(8)  =  96.5
codeTop  = 163 − codeUnits(66) = 97
maxLines = floor((97 − 96.5 − 2) / 8) = floor(−0.19) → 0
```

**Zero, and negative before the clamp.** `fitText` shrinking a long name cannot rescue it — the name
contributes at most 12 of the 66.5 units consumed, so nameSize 12/10/8/6/4 all give 0. The budget had
been reasoned against a different set of gaps than the painter drew.

## Why nothing caught it

Three independent gates each did the wrong thing quietly:

- The renderer returned `ingredientLines: 0` — correct, and reported.
- The sheet's *"Printing N ingredients"* copy was gated on `> 0`, so the line that would have said so
  **removed itself** in exactly the case worth reporting.
- The picker went on promising *"the full ingredient list"*.
- The unit test asserted the code **size** (0.529 mm/module) and nothing about whether a list fit
  beneath it. A bigger code scored better on the only number under test.

So the feature reported a smaller code as a win while printing none of the thing the code was
shrinking to make room for.

## The trade, resolved rather than dodged

Q-399 concluded the centred stack could not carry the list **and** a better code than `band`'s
0.369 mm per module. At the shipped type sizes that is right — three lines forces `codeUnits` 42.5,
i.e. 0.341. It is wrong at the type the mockup was actually drawn at.

Giving back 3 units of calories height (21 → 18) and 7 units of gap (7/6/5/8 → 5/4/4/6) takes the
header from **96.5 units to 86.5**:

| codeUnits | lines | mm per module |
|---|---|---|
| 56 | 2 | 0.449 |
| 52 | 2 | 0.417 |
| **50** | **3** | **0.401** |
| 46 | 3 | 0.369 |

**50 units, three wrapped lines, 0.401 mm per module** — above the old default's 0.369, and roughly
seven ingredients once the run wraps inline. The margin is one step wide: 52 gives two lines, not
three, which is why this is derived rather than picked.

Q-399 warned *"do not simply set it to 58"*. It was right, and there is now a test saying so.

## What stops it recurring

- **`stackGaps` is spec data, not literals in the painter.** `centredStackLineBudget(style)` reads
  the same four gaps the painter draws, so the constant and the layout cannot disagree.
- **The budget is a pure function.** Both vitest projects are `environment: 'node'`, so arithmetic
  left inside a canvas painter cannot be asserted at all — the same split that made
  `fitIngredientLines` testable in Q-393.
- **The test asserts the promise, not a constant:** every style with `ingredients: true` must have
  room for ≥ 1 line, and the default for ≥ 3. Plus two regression cases that reproduce v1.324.6's
  geometry as zero, and 58 units as zero.
- **The sheet reports zero loudly.** The `> 0` gate is gone; the line is gated on the *style*
  claiming a breakdown, and a count of zero renders in destructive colour with `role="status"`.
- **The picker no longer promises the full list** — "as much of the ingredient list as fits".
- **An E2E assertion on the default style**, alongside Q-393's on the square one.

Mutation-checked at both levels. Restoring v1.324.6's five numbers turns **four** unit tests red,
including *"every style that claims a breakdown has room to draw one"*.

## What the fix uncovered: the code was fuzzy, not just small

Shrinking the code box from 66 units to 50 made `e2e/meal-label.spec.ts`'s **decode of the rendered
canvas** start failing — and then passing again on a re-run, at identical geometry. The screenshot
showed a visibly correct, complete QR. That flakiness is the finding.

`drawCode` sizes a module as `box / 33` in sheet units against a canvas scaled by a constant, so the
module width in device pixels is `box × scale / 33` — **fractional for every style that ships**. At
the 3.12 scale that shipped: `band` 4.35 px per module, the new default 4.73, none of them whole.
Every module edge landed mid-pixel and antialiased to grey. The `+0.04` bleed already in `drawCode`
is an acknowledgement of exactly that, papering over the seams rather than removing them, and its own
comment says they "cost scan margin". A 6.24 px module out-votes the fuzz; a 4.73 px one does not.

**This is the printed artwork, not the preview** — share/save hands the viewer these pixels. So the
fix was to double the canvas to `DEFAULT_RENDER_SCALE = 6.24`: a 50 mm label is now 1,179 px, i.e.
**600 dpi**, and the default's module is 9.5 px. The decode is reliable again and every style's
artwork improved, including `band`, which was the tightest at 4.35 px and had never been checked
against a printer at that resolution.

Snapping the grid to whole device pixels is the real fix and is **filed as Q-358, not done here**:
flooring shrinks the drawn box, which makes `codeMm`, the sheet's mm-per-module line and
`mealLabelCodeMetrics` all disagree with the artwork — and that figure is precisely what the owner
reads before printing and what `meal-label-code-size.test.ts` asserts. At 600 dpi the shrink is ~5%
rather than the ~15% it would have been at 300, so it is a better change on the new base anyway.

`drawCode` is now the only place a code is drawn. The round painter carried a byte-identical inline
copy of the same arithmetic, which is the "One Formula, One Place" class and would have meant fixing
Q-358 in one of two places.

## What was NOT exercised

- **No print.** The two physical checks Q-389 owes are unchanged and are the ones that matter for a
  code this size: print at 50 mm and scan it. **0.401 is finer than the 0.487 originally believed
  safe** — that figure was the ÷25 reading and was never real, but the owner has still not scanned
  anything at 0.401. The 600 dpi artwork should help and is untested on paper.
- **The module grid is still fractional** (Q-358). What changed is that there is now enough
  resolution for it not to matter to a decoder. That is a margin, not a fix.
- **No device run.** JS-only; reaches the APK through a Railway deploy with no rebuild.
- The character budget per line (`charsPerLine`, measured from the real font) is unchanged and
  untested in isolation — "roughly seven ingredients" is inferred from it, not counted on paper.
