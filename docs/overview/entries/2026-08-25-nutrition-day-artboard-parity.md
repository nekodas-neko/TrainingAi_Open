# 2026-08-25 — the day screen's meal grouping was inverted (BF-24, artboard 1)

**Branch:** `feat/nutrition-day-artboard-parity` · **Lane B** · `nutrition-content.tsx` +
`meal-card.tsx`. JS-only — no APK needed.

## What the owner saw

*"Is that the final design? thats not what the mockup looks like (Nutrition — the day)"*, with
artboard 1 attached. Q-395b had ticked an 11-section coverage checklist and measured gap
reclamation, and the screen still did not look like the drawing — because the checklist was about
*behaviour* and the complaint is about *layout*. BF-28 makes parity the acceptance test.

## ④ is the one that mattered, and both layouts were "grouped"

Artboard 1 groups the **food rows within a meal**: the meal name is an uppercase label *outside and
above* a rounded card, with the meal's total right-aligned on that same line, and the card contains
only the rows. Q-395b grouped the **meals within one container**: a single bordered box with
`divide-y` hairlines, each meal's name *inside* it.

Both are legitimately describable as "grouped", which is exactly why ② passed its checklist and
still read as wrong. The fix is the inversion, not more grouping.

`grouped` was MealCard's only prop for that old shape and it had one call site, so it is gone rather
than left meaning nothing.

## ① and ⑤, and what was deliberately kept

- **The header is one band.** 26 px title with the **date** as its subtitle and the gear at the
  right — the shipped screen had a static *"Food diary & macros"* line that said nothing and pushed
  the date onto a second row of its own.
- **The meal header line is the name and one calorie number.** The emoji and the P/C/F chips are
  gone from it; the macros already have a home in the meal's totals footer, and the same split at
  two sizes was the noisiest thing on the screen.
- **The day chevrons and the per-meal ⊕ stay**, though the drawing shows neither. An artboard
  depicts a *state*, not the controls that reach it: the swipe alone is not a discoverable way to
  change day, and per-meal add is the only way to log to a meal that is not the current hour's. The
  chevrons' hit area went from 28 px to 44 px on the way, since they had to be rebuilt anyway.

## What did not ship, and why — the entry asks for this explicitly

- **② the energy block.** Merging `CalorieBalanceBar` into `MacroRing` as one donut-left card is not
  a day-screen change: `CalorieBalanceBar` also renders on `/health`
  (`health-sections.tsx:658`). Two screens, so it wants its own PR with Health verified alongside.
- **③ the four-tile action row.** Search · Scan · Photo · My meals overlaps **Q-395c**, which owns
  collapsing the capture entry points. Building four tiles before that entry decides what they open
  would wire destinations it may then change. Q-395c ships them.
- **⑥ the row thumbnail** is Q-406's — `food-row.tsx` says outright no call site passes one.
- **⑦ the four sections the drawing lacks** — `MealPlanReviewCard`, `MealPlanSection`,
  `TdeeAdaptationCard`, day-tools — **stay below the meals**. BF-28's rule 1: an artboard is 812 px
  and stops at the fold, so absence from it is not a deletion order. Recorded as decided.

## Verified

- **Structural parity against the artboard's own inline styles**, read back out of the running app
  at 412 dp: the title computes to `26px` / weight `600` (the drawing's `font-size:26px;
  font-weight:600`), the header is a single band, and all six meal types render an uppercase outside
  label.
- **11 nutrition e2e specs green** — `food-row-shared`, `meal-type-reassign`, `nutrition-tail-order`,
  `calorie-progress-bar`, `one-calorie-budget`. Behaviour is unchanged; only the arrangement moved.
- `tsc --noEmit` clean · lint clean on both touched files (the one warning in
  `nutrition-content.tsx` is a pre-existing `useLayoutEffect` dep at line 167, untouched).

## Not exercised

**Nothing visual was judged by eye.** Parity here was checked *numerically* — computed styles read
back and compared against the artboard's inline values — because that is what this harness can do.
Whether it now *looks* like the drawing is the owner's call on the device, and that is what the
entry keeps. The web sandbox also renders safe-area insets as 0, and the header is the element that
sits under the status bar.
