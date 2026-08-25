# 2026-08-25 — the artboards become the acceptance test

**Branch:** `feat/nutrition-mockup-parity` · docs-only · BugFix Intake

## What the owner asked for

*"I want the design to match the mockup images — that was my main interest, can you make sure the
design/ui is made to match the mockup. add it all in in the backlog tasks."*

That reframes the whole nutrition arc. Every phase so far was specified as **behaviour** — a coverage
checklist, gap measurements in pixels, a shared row component — and each one passed its own test
while the screens drifted from the drawings. Q-395b is the clean case: 11 of 11 sections ticked, gaps
cut from 16% to 11%, and the owner's first look at the result was *"thats not what the mockup looks
like"*. Parity is now the acceptance test rather than something alongside it.

## What was filed

**BF-28** is the map, and it exists so the other five entries are short. It carries the artboard →
shipped-file table for all twelve artboards, and the three arguments that would otherwise be had once
per entry:

1. **An artboard is 812 px — one screenful, not a total spec.** The shipped day screen carries four
   sections that appear in no drawing because the drawing stops at the fold. A section absent from an
   artboard is not thereby deleted.
2. **An owner decision beats the drawing, and one already does.** Artboard 2 draws four tabs
   (`Recent · Frequent · My meals · Recipes`); Q-395c's owner-set decision is two, because *Frequent*
   was a second ordering of what *Recent* already shows.
3. **Copy the layout, not the literals.** The artboards are hand-written HTML full of inline
   `oklch(...)` and `#22c55e`. `check-hex-literals.js` fails the Custom Rules job on the paste — and
   the designer made this argument themselves in the *"The green"* artboard: a literal opts out of
   both the accent the user picks and the darkening light mode applies, which is invisible in the one
   combination everything was built in.

Then one entry per screen: **BF-24** (the day, already open), **Q-395c** amended to own artboard 2,
**BF-29** (My meals), **BF-30** (Meal detail), **BF-31** (Edit meal), **BF-26** (Quantity).

Two artboards needed no entry — `Tap targets` and the three `srv/g` studies both shipped inside
Q-395a, the first as 48 dp in `ui/segmented-tabs.tsx` for all eight call sites, the second as a unit
toggle that appears once instead of on every row.

## The screenshot found a second sheet

The owner's ⑧ answer — *"everything looks the same"* — arrived with a picture, and it named a
different file than expected. There are **two quantity sheets**:

| | artboard 6 · `quantity-sheet.tsx` | `quick-edit-log-sheet.tsx` (the screenshot) |
|---|---|---|
| unit | `srv` / `g` toggle at 48 dp | none — servings only |
| presets | `1 srv · 2 srv · 3 srv · 100 g` | `×0.5 ×1 ×1.5 ×2 ×3` |
| macros | `230 kcal · P 52.8 · C 2 · F 0.6` | four equal uncoloured columns |
| actions | trash · Save | trash · Cancel · Save |

Q-395a built the first one to the drawing. Q-406 converted the diary row and shipped the second,
which is the one reached far more often. So the answer to *"the UI could use some work"* is not a
restyle — it is that the sheet the owner uses is not the sheet that was designed, and
`quantity-sheet.tsx` already implements everything the drawing asks for, including the grams handling
and the guard for items with no stated serving size.

The literal reading holds too: the `−`, the value and the `+` are the same rounded square with the
same fill and near-identical height, so the number the sheet exists to set has no more weight than
the buttons that nudge it. And the macro strip is monochrome while the food row **directly behind the
sheet** renders P green, C blue, F orange — the sheet does not import `MACRO_COLORS`.

## What is not decided

**BF-30 may not be a screen at all.** Artboards 1, 2, 3, 5 and 6 each map onto a shipped surface;
Meal detail maps onto a card's expanded state. Its first task is deciding whether it becomes a route,
a full-height sheet, or stays a card — and "stays a card" is an acceptable answer, written down with
its reason, rather than a route nobody navigates to.

**BF-29 has an ordering hazard with Q-395c**, which merges Saved meals / My Meals / My Foods into one
list under one name. Whichever ships second should not entrench a name the other has to sweep.
