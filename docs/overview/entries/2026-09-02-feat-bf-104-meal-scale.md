## 2026-09-02 — log a meal at ½× / 1× / 1½× (BF-104, v1.431.0)

**Branch:** `feat/bf-104-meal-scale` · **Lane:** B

The owner: *"when logging food/meals we should be able to choose how much of the meal; i.e full at 1x
or 1.5 or 0.5 etc."* LB-49 — the engine half this entry was split from earlier today — put the
`scale` argument through `logMealItems`. This is the surface that sets it.

**The split worked.** BF-104 was `PARKED` behind LB-49 this morning and became the queue head the
moment LB-49 merged, which is the whole point of filing the two halves separately rather than
skipping the entry.

### The picker had to change the sheet's own figures, and that was not in the entry

The meal detail sheet's headline calories and macro columns are documented in that file as *"per
portion — that is what `Log this meal` writes"*. **The moment the button can write 1.5 portions, a
figure fixed at one stops describing the button** — the two-numbers-for-one-thing class LA-45 and
BF-99 each closed. They scale with the picker now, and the label under the headline says which
portion it is showing (`per portion` → `1½× portion`).

### Decisions

- **`SegmentedTabs`, not `QuantityEditor`.** The entry said to reuse rather than add a third quantity
  control. `QuantityEditor` is the wrong one to reuse: it edits a **single food** in grams or
  servings, with a stepper, a unit toggle and macro tiles. This is a **meal-level** portion, and the
  primitive `QuantityEditor` itself uses for its own toggle is the one that fits.
- **Discrete taps, never a free-number field** — the entry is explicit, and a keyboard for a value
  that is almost always one of three is the worse control besides.
- **The values live in a `.ts`, the picker in a `.tsx`.** Both vitest projects run
  `environment: 'node'` and cannot parse a `.tsx`, so anything asserted directly rather than by
  source-scan has to live outside the component. The split is the better shape anyway.
- **The row's one-tap log is unchanged**, defaulting to 1. Only the detail sheet passes anything else.
- **Reset to 1× whenever a different meal opens.** A portion is a fact about one sitting.
- **The scanned-label path deliberately has no picker.** `handleScannedSavedMeal` is scan-and-go in a
  kitchen; interrupting it with a portion question is the opposite of what that flow is for.

### Verification

- 11 unit tests, **seven mutations kill them**: the factor never reaching `onLog`, the scale never
  reaching `logMealItems`, the displayed figures not following the picker, no reset between meals, a
  free-number field instead of taps, a fourth scale, and a changed quick-log default.
- `e2e/meal-portion-scale.spec.ts` — 2 tests on the real sheet, **three mutations kill them**. The
  headline moves **400 → 200 → 600** with the picker, and logging at 1½× writes
  `quantity_multiplier` **1.5** — **read back from the database**, not from a toast, because a UI
  that said "logged" while writing 1 would look identical.
- `pnpm check:rules` **Ran 67 of 67**; full unit suite (740 files, 6,292 tests), tsc and lint clean.

**Two locator traps, both found by the specs failing first:** `getByText('per portion')` matches the
library sheet's own footnote (*"Meal calories are per portion…"*), and `getByRole('tab', {name: '½×'})`
also matches `1½×`, whose label contains it. Both needed `exact: true`.

### Not exercised

- **The device.** Three segments join an already-full detail sheet at 412 dp, each on the 48 dp
  floor, directly above the action row. Whether the sheet still fits without scrolling to reach
  `Log this meal` is unchecked.
- **⚠ `saved-meals-sheet.tsx` is at 798 lines against the 800 limit** — two lines of headroom, and it
  is **not** in `check-component-size`'s baseline, so the next addition fails as a *new* file over
  the limit rather than as a tracked hotspot. Extract before adding there.
