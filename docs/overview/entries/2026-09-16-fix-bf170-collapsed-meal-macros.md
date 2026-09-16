# 2026-09-16 — `fix/bf170-collapsed-meal-macros`

**BF-170** — a logged meal in the Nutrition diary showed its protein, carbs and fat nowhere.
v1.456.23.

## The defect

`mealFooter` withholds a section's totals footer when the section holds a single meal, on an
explicit premise written in its own source: *"A group row states its own macros AND calories; a
loose row states neither."*

The group row did not keep that promise. `diary-meal-group.tsx` renders the thumbnail, the name, the
ingredient count, the **calories** and a chevron in its always-visible header; the P/C/F line sat
**inside `{open && …}`**, under the ingredient rows. Collapsed — which is the default, and
deliberately so, because the flood of one meal as eight sibling rows is what BF-39 was filed on — the
row stated calories only. So the footer was withheld for a claim that was half true, and the macros
appeared nowhere.

The owner's screenshot is **PRE WORKOUT** (one saved meal, five ingredients) showing no P/C/F
directly above **POST WORKOUT** (one loose food) showing *P 17g · C 17g · F 10g*.

**This is BF-120's own defect with the kinds swapped.** That entry's reasoning, still in
`meal-card-footer.ts`, reads: *"a section holding one loose food showed protein, carbs and fat
nowhere, while the section above it showed all three."* Same sentence, meal and food exchanged.

## The fix

The P/C/F line moved out of the expansion to sit full-width under the header — and outside the
header's `role="button"`, since it is not part of what toggles and the entry asked that the
four-element row not gain a fifth thing.

Fixed at the **group**, not at the footer, as the entry directed. That makes `mealFooter`'s premise
true for **every** meal group rather than only a lone one, needs no change to the decision table,
and avoids the duplicate that fixing it in `mealFooter` would produce the moment the group opened.
`mealFooter` and `meal-card.tsx` are untouched.

No duplication anywhere else: the section's own `MealTotals` renders only while the **section** is
collapsed, which hides the group entirely.

## The e2e covered this component and could not see it

`e2e/diary-nested-meal.spec.ts` had four tests over `DiaryMealGroup`, and **none of them could fail
on this defect**. The one that asserts `P 24g` taps the row open first, so it passed throughout —
the entry spotted this and it is worth recording, because the file reads like coverage.

A fifth case now asserts **before any tap**: the group is still `aria-expanded="false"` with every
ingredient name absent, and `P 24g` / `C 60g` are each on screen exactly once. Counted rather than
scoped, which is the stronger form BF-120's own case uses — `toHaveCount(1)` fails on 0 (this
defect) and on 2 (a duplicate). It then opens the group and re-counts.

**Proven load-bearing in the browser:** against the unfixed component it fails with
`Expected: 1, Received: 0` — the owner's screenshot reproduced in the harness.

## What was verified, and what was not

- `components/nutrition/__tests__/bf170-collapsed-meal-macros.test.ts` — **1 of 4 assertions fails
  against `main`** (the ordering one, which is the fix). The other three are pins that pass on both
  sides: the macro line appears exactly once, the expansion still carries the ingredient rows, and
  `mealFooter`'s three cases are unchanged. Stated rather than counted as evidence.
- `e2e/diary-nested-meal.spec.ts` — **7 passed**, including BF-39's collapse behaviour, BF-98's
  no-duplicate-footer case and BF-120's lone-loose-food case, all unchanged under this fix.
- Full suite **7513 passed**, `pnpm check:rules` **Ran 75 of 75**, lint 0 errors, build clean.

**NOT exercised: the device.** What the S25 adds over the harness here is width — the macro line
sits under a header already carrying a thumbnail, a name, an ingredient count, a calorie figure and
a chevron, and the harness runs a mobile viewport but not Samsung's WebView. Native SQLite,
safe-area insets and drifted production data were all untouched. BF-170 carries `Verify: device`.
