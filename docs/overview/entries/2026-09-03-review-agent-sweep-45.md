# Review sweep 45 — the FK edges into user-scoped tables

**Date:** 2026-09-03 · **Agent:** 📖 Review · **Branch:** `claude/review-agent-sweep-45` · Docs only.

The top item on the baton's Next list since sweep 40: the foreign-key edges RV-32 came out of. Four
were probed then; the rest were left as *"the cheapest next lens this role has"*.

**The inventory is 31 edges, not the 27 sweep 40 counted** — the schema grew. Twenty have no `user_id`
on the child table, which is the RV-32 shape: the FK proves the parent row exists, never whose it is.
The query is in §2 of the write-up; re-run it rather than trusting a remembered count.

**Four nutrition edges hold, each proven with a control:**

| Edge | B using A's id | Control (B's own) |
|---|---|---|
| `food_logs.food_item_id` | 400 | **201** |
| `food_logs.meal_type_id` | 400 | **201** |
| `food_logs.saved_meal_id` | 400 | **201** |
| `supplement_logs.supplement_id` | 404 | **200** |

The controls are not ceremony — three of those first returned a 400 for an unrelated reason (a missing
field, a wrong body shape, a wrong route), which reads exactly like a guard firing.

**RV-42 is the finding.** `meal_plan_meals` rows take `savedMealId` and `mealTypeId` straight from the
request. The *plan* is ownership-checked (`ownedPlan`); the child ids are not, and `z.string().uuid()`
proves the shape and nothing about the owner. The table has no `user_id`, so the FK is the only
ownership link. Both doors were driven as a second account: `POST /api/nutrition/meal-plans` → 201,
`PATCH /api/nutrition/meal-plans/meals/[mealId]` → 200, and Postgres read back showing B's plan meal
pointing at A's saved meal *and* A's meal type.

**No data leaks, and checking that is what set the severity.** The meal-plan read joins neither
`saved_meals` nor `meal_types`, so `savedMealName`/`mealTypeName` come back `null` — the half RV-32 had
and this does not. What it does cost is a cross-account write: both columns are `ON DELETE SET NULL`,
so with B's plan holding A's `saved_meal_id`, A deleting their own saved meal through their own API
(`200 {"success":true}`) left B's row reading `<NULLED>`. Neither account can see why.

The fix is the pre-check `writeSavedMeal` already implements for its equivalents, citing rule (c) while
doing it — the two files disagree about the same question. Not a composite FK: that would work and is a
migration on a table two routes write.

**Not exercised:** the device; production. The **workout and device FK edges** (`program_phases`,
`schedules`, `set_hr_stats`, `blood_analytes`, `dexa_scan_regions`, `exercise_logs`, `prescribed_runs`)
are **untouched, not clean**. All probe rows were deleted afterwards.

Write-up:
[`docs/reviews/2026-09-03-fk-edges-meal-plan-cross-user-refs.md`](../../reviews/2026-09-03-fk-edges-meal-plan-cross-user-refs.md).
