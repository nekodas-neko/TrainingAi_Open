# 2026-09-08 — a meal plan's lifecycle gets tests (PS-39)

**Branch:** `test/nutrition-meal-plans` · **Lane:** A · tests + docs only, no product code.

## What shipped

`lib/__tests__/nutrition-meal-plan-routes.test.ts` — 24 cases across `nutrition/meal-plans` (list
and create), `…/meal-plans/[id]` (read, edit, delete), `…/[id]/review` and `…/meals/[mealId]`.
Batched because they are one object's life, and each holds a decision the response shape hides:

- **Someone else's plan is a 404, never a 403.** The route says why: a 403 makes an id that exists
  distinguishable from one that does not, turning the id space into an enumeration oracle. All four
  routes answer 404, and the case asserts it across every verb at once.
- **Activation is transactional, not a settable field.** `isActive` leaves the whitelisted patch and
  goes through `setMealPlanActive`, which clears the previously active plan — writing it as a column
  would leave two plans active. Deactivation takes the same path rather than becoming a no-op.
- **`scaleToTarget` is opt-in, and scales against the meal's OWN stored targets.** A rename PATCHes
  the same route, and a rename must not silently reprice a meal or spend an AI call. The targets are
  re-read from the repository rather than taken from the request, so a client sending wrong ones
  cannot reprice the meal either — the case sends deliberately wrong targets and asserts the stored
  ones were used.
- **A plan's variants are `all` alone or the `training`+`rest` pair.** A partial split would leave
  one day type with no plan at all; the check sorts first, so order does not matter.

Also pinned: allergies and avoidances reach the top-up as separate lists; `scaleToTarget` is a
control flag and never a stored column; the ownership 404 lands *before* any scaling, so a meal that
is not the caller's costs no AI call; `.strict()` at every level of the create body (plan, variant
and meal); the ingredient snapshot the plan was built from survives; and `activePlanId` is derived
from the flag rather than defaulting to the first plan.

`scripts/check-route-test-coverage.js` baseline 108 → **104**.

## Notes

- **Fourteen mutations, all caught** — after one had to be rewritten. The first attempt at "scale
  before checking ownership" kept the guard and added a no-op line beside it, so it proved nothing;
  the real version substitutes zeroed targets for the missing meal, and the case fails. That is the
  second time this session a survivor turned out to be a badly-aimed mutation rather than a weak
  test, which is its own argument for re-reading the mutation before trusting the verdict.
- The family's other two routes — `…/[id]/structure` (185 lines) and `plan-meal-answers` (110) — are
  left for a following batch rather than stretching this one to six routes and 600 lines.
