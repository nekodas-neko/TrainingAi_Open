# 2026-09-29 — LA-172: a plan meal gets a meal type by its time, unless it is tagged

**Lane A · `packages/shared/src/nutrition/meal-type-for-time.ts`, `lib/data/postgres/slices/meal-plans.ts`,
migration `202609290804_plan_meal_type_from_suggested_time.sql` (backfill, standing policy).**

- **The owner's answer:** *"Give it a type by its time; as well as what its tagged with."* A plan
  meal's type is now **tag → the window containing its suggested time → the NEAREST window**.
  - It is applied on plan create and structure replace, and when an untyped meal's time is edited.
  - A stored type is never overridden, because it may be his tag.
- **Why "nearest" and not "none":** his real meal-type hours have gaps (6-10, 10-12, 12-15, 18-21), so
  a strict window match left 4 of his 8 meals untyped (16:20, 21:00), which is not "a type by its
  time". The logging path's first-bucket fallback would have filed a 21:00 snack as breakfast.
- **One rule, both sides:** `planMealTypeId` in a dependency-free module (the server cannot import
  `log-plan-meal.ts`, which pulls in the local store); the migration's SQL implements the same
  ordering. `listMealTypes` gained a `created_at` tie-break so the list order is the one the SQL
  uses.
- **On the owner's data** (fresh production snapshot, restored with all counts matching, applied through
  the real runner), all 8 meals are typed:

  | Time | Meal | Type |
  |---|---|---|
  | 07:00 | Protein Shake + Rice thins | Pre Workout (Breakfast) |
  | 11:40 | Turkey and Rice Bowl | Post Workout (his own 10-12 window) |
  | 16:20 | Chicken and Sweet Potato | Lunch (nearest) |
  | 21:00 | Greek Yoghurt and Almonds | Dinner |

  The same four apply on both variants. **⚠ Those 8 belong to his only plan, which was soft-deleted
  on 2026-08-11**, so the backfill changes nothing he sees now; the create and edit paths are what
  his next plan uses.
- **Tests:** the rule (containing, gaps, exclusive end, tag, overlap tie, unreadable), and
  real-Postgres create/edit/backfill tests. The meal-plan suites pass (547 plus 119 route tests).
- **Unblocks BF-203a.** The plan screen showing "Lunch · …" is Lane B's.
