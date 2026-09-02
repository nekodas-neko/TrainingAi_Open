# 2026-09-02 — the Review sheet was the one food surface with no macro/calorie cross-check (BF-109)

**Lane B · branch `fix/bf-109-macro-calorie-warning` · v1.431.1**

The owner scanned barcode `9350167000490` and got **173 kcal** beside **45.7 P / 52.1 C / 13.6 F** —
macros that come to **514** by Atwater, a **197%** disagreement — and read it as a calorie-calculation
bug.

## The screen was right and the row was wrong

The entry had already established this, and checking it confirmed it rather than re-deriving it. OFF
carries, on the **same** per-serving basis the app used for every field, `energy-kcal_serving 173`
against `proteins_serving 45.7`. `offProductToNutrition` read `_serving` consistently. The mapper is
correct; that product's energy is wrong at source, and `energy-kcal_100g` is 173 ÷ 3.5 — OFF derived
the per-100g figure from the same bad number, so there is nothing in the row to fall back to.

**This is the third BF-109-adjacent thing worth recording: the entry was right about all of it.**
Six of the last several entries this session were wrong about something load-bearing. This one had
read the source row, the mapper and both halves of the shared check before filing, and every claim
held.

## The guard already existed and this was the surface without it

`macroCalorieDisagreement()` and `MACRO_MISMATCH_VISIBLE_LIMIT = 0.15` have been in
`packages/shared/src/nutrition/scan-totals.ts` since they were written, for this exact failure against
this exact data source — the docstring names it. The OFF text-search list surfaces the disagreement;
`/api/nutrition/scan` and `/api/nutrition/food-items` run `sanitiseNutrition`. The barcode path does
neither, and `logFoodEntries` deliberately does not sanitise. A sibling-surface gap, and no new formula.

## It covers more than barcode, deliberately

The entry frames this as the barcode path. The fix went into `review-step.tsx`, which is reached by
`handleScanResult` (**barcode and photo scan**) and by `handleManual`, so all three roads now carry the
cross-check. That is the sibling-surface rule read forward rather than a widening: putting it on the
barcode branch alone would have left the photo scan — same OFF-shaped data, same sheet — without it.
The check returns `null` unless both the stated calories and the Atwater sum exceed zero, so a blank or
half-typed manual form shows nothing.

## It warns and offers; it never rewrites

The entry is explicit and the reasoning holds: Review exists for the user to decide, and a screen
showing one number while the store keeps another is a worse bug than the one being fixed. It would also
destroy the legitimate case — fibre and alcohol put real foods 10–20% out, which is exactly what the
15% limit sits above. Declining the correction logs the label's own number, unchanged.

## The number fields had no accessible name

`numField`'s label is a sibling `<span>`, tied to nothing, so a screen reader read "spin button" and no
more, six times over. It carries `aria-label` now. That started as what lets a test address the Calories
field by name among six identical inputs, which is the honest account of how it was found — but an
unlabelled number input is a real defect on its own, and this is the file the change was already in.

## Verification

- **9 unit tests.** Two pin the **premise** — the owner's row at 1.97, and the 514 the warning offers —
  so a change to the shared check or its limit surfaces here as a number rather than as silence. Three
  pin what must *not* be flagged: agreeing macros, a high-fibre food a little out, and a genuinely
  calorie-free item rather than a divide by zero. **Six mutations kill them.**
- **`e2e/macro-calorie-warning.spec.ts` — 2 tests against the rendered sheet, and it exists because the
  unit guards cannot see the thing that matters.** They assert arithmetic and that the source contains
  the component next to the Calories field; neither renders anything. The spec drives the real fields,
  reads the warning's own sentence, checks the field still holds 173 **before** the tap, taps `Use 514
  kcal`, and checks it holds 514 and the warning is gone. **Five mutations turn it red**: the warning
  never rendering (`{false && …}`), an inert button, the threshold removed so it warns on everything, a
  rewrite on mount instead of on the tap, and an Atwater sum missing fat.
- One unit assertion had to be rewritten. `expect(src).toContain('<MacroCalorieWarning')` passed against
  `{false && <MacroCalorieWarning` — the text is still there while the warning never renders, which is
  the shape of guard that reads as coverage and is not. It is adjacency to the Calories field now, and
  its regex needs `[\s{}]*` rather than `\s*`, because `source()` strips `/* … */` and a JSX comment
  leaves its braces behind.
- `pnpm check:rules` **Ran 67 of 67**; full unit suite green; `tsc --noEmit` and lint clean.

The first draft of the component copied `macro-targets-pane.tsx`'s existing banner and its `#f59e0b`
literals, and `check-hex-literals` refused it. `--accent-amber` through `color-mix` is the token, and
`components/cardio/time-picker-sheet.tsx` is the pattern. A literal being present in the repo is not
evidence it is allowed.

**Not exercised:** no barcode was scanned — the e2e reaches the identical `ReviewStep` with the
identical props by the manual road, because a barcode needs a camera. So what is proven is the sheet's
behaviour given those numbers, not `/api/nutrition/barcode` delivering them. The device, safe-area and
Samsung WebView are untouched by the diff, but the banner is new UI between the Calories field and
Protein inside a sheet that already scrolls, and it has not been seen at 412 dp. Both are held open by
the entry's `Keep:`.
