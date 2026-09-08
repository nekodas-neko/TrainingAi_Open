# 2026-09-08 — the meal-plan reshape gets tests (PS-39)

**Branch:** `test/meal-plan-structure` · **Lane:** A · tests + docs only, no product code.

## What shipped

`lib/__tests__/meal-plan-structure-route.test.ts` — 24 cases against
`PATCH /api/nutrition/meal-plans/[id]/structure`, 185 lines that change a saved plan's shape: how
many meals it splits into, when training sits, whether it still runs against the calorie target it
was built for, and what order the meals come in.

**No AI is involved** — all of it is redistribution through `splitMacrosAcrossMeals`, the same
function the generator used, so the answer is deterministic. That is exactly what makes it worth
pinning rather than trusting: every decision it makes is invisible in the response shape.

- **A reorder must be a permutation of the slots that exist**, and it is validated against the
  *new* meal count when the count changes in the same request. Anything else duplicates one meal
  and silently drops another.
- **The food survives a reshape; only the numbers move.** Names, notes and the ingredient snapshot
  carry over by position — and with the order when one is given, so a meal that moves takes its
  food with it. Portions are deliberately **not** rescaled: the new target is shown against
  unchanged ingredients so the drift is visible rather than hidden.
- **A slot that did not exist before is reported, not disguised.** `unnamedPositions` is what lets
  the client say "placeholder" instead of implying new food was invented.
- **`retarget` never derives a third number.** The saved target wins, the calibration fills the gap,
  and when neither exists it refuses rather than guessing. Saved macros that do not sum to their own
  calorie goal are reconciled the same way the generator does — calories win, protein and fat are
  kept, carbohydrate takes the remainder.
- **Changing the day-type split is a rebuild, not a reshape**, so the plan keeps whichever variants
  it already had; a rest day takes 15% off its carbohydrate and the calories follow at 4 kcal a
  gram rather than drifting apart.

`scripts/check-route-test-coverage.js` baseline 104 → **103**.

## Notes

- **Fourteen mutations, all caught**: removing the permutation check, checking it against the old
  count, ignoring the order when carrying names, emptying `unnamedPositions`, dropping the
  ingredient carry-over, preferring the calibration over the saved target, guessing instead of
  refusing, a zero rest-day reduction, calories not following the carbohydrate, rebuilding the day
  types as `all`, skipping the reconciliation, retargeting when not asked, ignoring a
  `trainingTime` override, and dropping `.strict()`.
- `splitMacrosAcrossMeals` is deliberately **real** — the determinism is the claim, and a mocked
  split would pin nothing about it. The macro cases assert the parts sum to the whole rather than
  restating the split's own arithmetic, which keeps them honest about what they check.
- `plan-meal-answers` is the meal-plan family's last uncovered route.
