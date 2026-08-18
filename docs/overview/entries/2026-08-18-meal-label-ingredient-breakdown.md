# 2026-08-18 — Q-393: the ingredient breakdown on the label, and a pitch figure that was wrong

**Branch:** `claude/implementation-lane-b-0o7kb9` · **v1.323.0** · **Lane:** Implementation B

The owner moved this to the top of the queue: *"could we have a small font showing the break down of
the meal i.e Pasta / [macros] / (100g pasta, 200g mince, etc etc)"*. It is a follow-up to Q-389,
which shipped the renderer the day before.

## What shipped

A fifth style, **Square · ingredients**: the per-serving ingredient list — `200g Beef mince`, one
line each, up to five — with calories and macros beside a large code, and the write-on rule beneath.

The entry's measurement decides the shape and it holds: on a **round** 50 mm label the usable box is
130 × 137 and the shipped default already spends all of it, leaving **7 units — zero lines**. A list
cannot go on a round label without taking something off it. The square die gets the corners back
(171 × 171) and the list fits with room to spare.

So the new style is marked **SQUARE** in the picker and carries a standing warning under the preview
that a round die crops the list — which Q-393 explicitly requires rather than letting a round die
silently cut it.

**The ingredients are per serving**, from `savedMealToIngredients`, which goes through
`oneServingItems` exactly as `mealLabelFigures` does. That is deliberate: the weights and the
calories printed beside them describe the same portion. Feeding it the whole recipe would have put a
batch ingredient list next to a per-serving calorie count on a physical tub.

The preview now also reports **how many ingredients actually printed** and how many were summarised
as "scan for the full list". A list that stops at five without saying so is the quiet failure this
feature was most likely to ship.

## The correction, which matters more than the feature

**Every module-pitch figure in Q-389 and Q-393 is ~24% too optimistic.** The renderer draws the
4-module quiet zone *inside* the code box (`cell = codeW / (moduleCount + 8)`), so the pitch actually
printed divides by **33**, not 25:

| style | code | documented (÷25) | **as drawn (÷33)** |
|---|---|---|---|
| band (default) | 12.17 mm | 0.487 mm | **0.369 mm** |
| editorial | 13.23 mm | 0.529 mm | **0.401 mm** |
| ticket | 13.76 mm | 0.550 mm | **0.417 mm** |
| plaque | 15.87 mm | 0.635 mm | **0.481 mm** |
| **square (new)** | 18.52 mm | 0.741 mm | **0.561 mm** |

The app was already displaying the honest number — only the docs were wrong, so nothing shipped
incorrectly. But it makes the still-owed print test **more** important, not less, and it is why the
square style was sized at 70 units: **0.561 mm is the only pitch in the set above the 0.487 that
every one of these figures was assumed to have.**

## What was deliberately not built

**Option 2, the round trimmed list.** At 44 units its true pitch is **0.353 mm** — below every
shipped style, not merely below the "0.487 floor" the entry names. It buys three of five ingredient
lines at 6.5 px in exchange for the least reliable code in the feature, and Q-393's own framing is
that a partial list is what the request was trying to avoid. Left for the owner with a
recommendation against it.

**A stored default.** Q-393 says to build it on whatever Q-392 settles rather than beside it, so the
style stays picked-at-print-time and nothing was persisted.

## Guard

`e2e/meal-label.spec.ts` extended to drive all five styles.

**The first version of the new assertions was not a guard, and mutation-checking caught it.** With
`ingredients: true` removed from the square spec, the style falls through to the *round* painter — so
the canvas still had ink and the square-only warning still showed, and **both new assertions passed**.
That is the Q-259 lesson exactly. The renderer now returns what it drew (`ingredientLines`,
`ingredientOverflow`), the sheet displays it, and the spec asserts on that number — which fails under
the same mutation. The reported count is a real contract, not test scaffolding: it is what tells the
user their list was truncated.

## What was NOT exercised

- **Nothing was printed, and nothing was scanned.** Both remain owed from Q-389 and this change does
  not discharge either. **Print black band first** — it is the default and, at 0.369 mm, the tightest.
- **No square label has been cut.** The square-only claim is geometry, verified in the preview at
  true 50 mm scale, not against a real die.
- **A long ingredient list was not printed** — the overflow path ("+N more") is asserted in the
  preview's reported count, not on paper.
- **The device.** Chromium at 412×915; the new style's 7.5 px ingredient lines are the smallest type
  in the app and want a look on the S25.
