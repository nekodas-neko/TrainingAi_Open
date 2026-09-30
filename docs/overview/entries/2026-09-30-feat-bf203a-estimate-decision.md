# 2026-09-30 — BF-203a Tasks 3–4: which plan meals are owed an estimate

**Branch:** `feat/bf203a-estimate-decision` · **Lane A** · pure module, not wired to anything yet.

## What shipped

`packages/shared/src/nutrition/meal-estimate.ts`:
- `dueForEstimate`: a slot is owed an estimate once it is over, when no food of its meal type is
  logged and no live answer exists. The bias is spread in proportion to slot size, never below 0 kcal.
- `slotCloseHour`: when a slot is over.

## Two corrections to the plan

1. **Matching is by meal type, and a logged meal satisfies every slot of its type.** The plan passed
   `loggedPlanMealIds`, which no caller can build, because `food_logs` has no plan-meal id. When two
   slots share a type, one goes un-estimated rather than both counting on top of real food. This
   under-counts by one meal and never double-counts.
2. **A slot closes at the later of its type's end and an hour past its suggested time.** LA-172 files
   the owner's 16:20 meal under the nearest window (Lunch, 12–15), so the plan's "type end" would
   have estimated it at 15:00, before it was due. A type ending at 24 never closes the same day, so
   that slot is not estimated. That is accepted: the plan only estimates today.

## Verified

`meal-estimate.test.ts`: 13 passed. It includes the plan's user-local boundary cases, run in a
fixed-offset zone so they fire on every CI run.
