# 2026-08-25 — there were two quantity sheets, and the busier one was the wrong one (BF-26)

**Branch:** `fix/quantity-sheet-convergence` · **Lane B** · one new shared component, two sheets
shrunk. JS-only.

## What the owner photographed

*"the UI could use some work; everything looks the same"* — and the screenshot named the wrong sheet
in a useful way. `quantity-sheet.tsx` (the meal builder's, Q-395a) already matched artboard 6.
`quick-edit-log-sheet.tsx` — the one reached by tapping any logged row on the day screen, so far
more often — did not: no unit toggle, `×0.5 ×1 ×1.5 ×2 ×3` multipliers instead of absolute presets,
and four identical monochrome macro columns with `kcal` among them at the same weight.

The complaint was literally true of it. The `−`, the value and the `+` were the same rounded square
at the same fill and near-identical height, so the number the sheet exists to set had no more weight
than the buttons that nudge it.

## One editor, two sheets

The defect was that the two existed separately, so the fix is
`components/nutrition/quantity-editor.tsx` — the stepper, the unit toggle, the presets and the macro
line — rendered by both. `qtyFromInput` and `steppedQty` come with it, so grams and servings cannot
drift apart between the builder and the diary. Each sheet kept only its own header and actions:
`quantity-sheet.tsx` 156 → 83 lines, `quick-edit-log-sheet.tsx` 195 → 158.

`MACRO_COLORS` is in the editor, so P/C/F read the same inside the sheet as on the row behind it.

**Cancel is gone**, which the entry asked to be decided explicitly. The drawing has none, and the
sheet already had two ways out — the X that `SheetContent` renders, and the back gesture that
BF-27 shipped this morning. A third beside a bin was the ambiguous control, not a safety net;
nothing is written until Save, so every exit discards the edit identically.

## The finding: a font-size class on an input does nothing on a phone

Item ③ asked for the value to be *"larger and visually distinct from its steppers"*. `text-2xl` on
the input **had no effect**, and the probe said so: 16 px.

`app/globals.css:530` sets `input, textarea, select { font-size: 16px !important }` inside
`@media (max-width: 640px)` — the iOS-zoom guard, and 640 px covers every phone, which is the only
runtime that matters here. So a size class on an input is inert on the canonical target while
looking perfectly correct in the source.

`!text-2xl` fixes it, and does not reintroduce what the guard prevents: the guard wants a **floor**
of 16 px to stop focus-zoom, and 24 px clears it. Measured after: value 24 px in a 56 px box against
48 px steppers.

**Scope, measured rather than assumed:** only two other inputs in the app carry a size class, and
both want ≤16 px — which is exactly what the guard exists to enforce. So this bites only when a
caller wants *larger*, and mine was the only one. Narrow, but silent, and worth knowing before
someone else spends an afternoon on it.

## Verified

- **12 e2e specs green**, chosen because they drive these two sheets or their neighbours:
  `sheet-back-dismiss` (which opens the quick-edit sheet directly), `back-dismiss-sweep`,
  `food-row-shared`, `plan-meal-to-saved-meal`, `recipe-url-to-meal`.
- **Read back out of the running app at 412 dp**: the diary sheet renders `srv`/`g`,
  `1 srv · 2 srv · 3 srv · 100 g`, and `200 kcal · P 26 · C 1 · F 0` in
  `rgb(34,197,94)` / `rgb(59,130,246)` / `rgb(249,115,22)` — the `MACRO_COLORS` values exactly. Its
  buttons are Remove · Save · Close, with no Cancel.
- `tsc --noEmit` clean · lint clean on all three files.

## Not exercised

**The device.** The action row's safe-area inset renders 0 in the sandbox and Remove sits in that
row. And whether the sheet now reads as *one thing* rather than a wall of equal squares is a visual
judgement I cannot make — I can only show that the sizes, colours and controls now differ where the
drawing says they should. That is what the entry keeps.
