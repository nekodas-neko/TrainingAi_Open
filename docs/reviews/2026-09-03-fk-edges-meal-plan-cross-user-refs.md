# The FK edges into user-scoped tables: four nutrition edges hold, two let a meal plan point at someone else's rows

**Date:** 2026-09-03 · **Agent:** Review 📖 (sweep 45) · **Pillars:** `[nutrition]` `[platform]`
**Lens:** the top item on the baton's Next list since sweep 40 — the foreign-key edges into user-scoped
tables that RV-32 came out of. Four were probed then; the rest were left as *"the cheapest next lens
this role has"*.

**The inventory is 31 edges now, not 27** — the schema has grown since sweep 40 counted. Twenty of
them have **no `user_id` on the child table**, which is the RV-32 shape: the foreign key proves the
parent row *exists*, never whose it is.

Four nutrition edges came back clean, each proven with a control. Two did not: a meal plan can be
created or edited to point at **another account's saved meal and meal type**, through two separate
routes, and because both columns are `ON DELETE SET NULL` the owner of the referenced row silently
mutates the other account's plan by deleting their own data.

---

## 1. Method, and what it does not establish

Live against `pnpm dev` on the seeded local Postgres as two authenticated accounts (**A** = seeded,
**B** = the harness's zero-data account). Every probe a real HTTP request with a session cookie, every
result read back out of Postgres, and **every refusal paired with a control** — the same request with
only the foreign id swapped for the caller's own — because a 400 alone cannot distinguish "the guard
fired" from "my payload was wrong". All probe rows were deleted afterwards (verified: 0 plans, 0
probe food items, 0 probe saved meals).

What this does not establish: the **web** build only; the local seeded database, not production; and
the 20-edge inventory was probed for the **nutrition** edges plus the meal-plan pair. The workout and
device edges (`program_phases`, `schedules`, `set_hr_stats`, `blood_analytes`, `dexa_scan_regions`,
`exercise_logs`, `prescribed_runs`) are **not** probed and are recorded here as untouched, not clean.

## 2. The inventory

```sql
-- FKs whose parent is a user-scoped table, flagged by whether the CHILD carries user_id
WITH fk AS (
  SELECT tc.table_name AS child, kcu.column_name AS child_col,
         ccu.table_name AS parent, rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu USING (constraint_name)
  JOIN information_schema.constraint_column_usage ccu USING (constraint_name)
  JOIN information_schema.referential_constraints rc USING (constraint_name)
  WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'
), scoped AS (
  SELECT table_name FROM information_schema.columns
  WHERE column_name='user_id' AND table_schema='public'
)
SELECT * FROM fk WHERE parent IN (SELECT table_name FROM scoped) AND parent<>'users';
```

**31 rows. 20 have no `user_id` on the child.** Keep this query rather than the count — the count was
27 three weeks ago.

## 3. Four nutrition edges hold, with controls

| Edge | Probe (B using A's id) | Control (B's own id) | Rows written |
|---|---|---|---|
| `food_logs.food_item_id` | `400 "Invalid mealTypeId, foodItemId or savedMealId"` | **201** | 0 |
| `food_logs.meal_type_id` | `400` same | **201** | 0 |
| `food_logs.saved_meal_id` | `400` same | **201** (same body, no `savedMealId`) | 0 |
| `supplement_logs.supplement_id` | `404 "Supplement not found"` | **200 `{"ok":true}`** | 0 |

`food-logs`'s guard is `repo.foodLogRefsValid(userId, mealTypeId, foodItemId, savedMealId)`, and its
comment states the reason outright: *"a log naming someone else's meal would render their name and
picture in this user's diary."* That is the rule (c) posture, applied and working.

**The controls are not ceremony.** Three of these first returned a 400 for an unrelated reason — a
missing field, a wrong body shape, a wrong route — which reads exactly like a guard firing. Only the
pair proves anything.

## 4. RV-42 — a meal plan can point at another account's saved meal and meal type

`replaceMealPlanStructure` and the create path both insert `meal_plan_meals` rows straight from the
request:

```ts
await tx.insert(s.mealPlanMeals).values(v.meals.map(m => ({
  variantId: variant.id,
  mealTypeId: m.mealTypeId ?? null,   // client-supplied, never ownership-checked
  savedMealId: m.savedMealId ?? null, // client-supplied, never ownership-checked
  …
```

The **plan** is ownership-checked (`ownedPlan(db, id, userId)`); the **child ids** are not. Both are
`z.string().uuid()` at the boundary, which proves the shape and nothing about the owner.

`meal_plan_meals` has no `user_id` column, so the FK is the only ownership link — and it only proves
the row exists. Compare `writeSavedMeal`, which verifies both of its equivalents and cites rule (c) by
name while doing it. The two files disagree about the same question.

### Two doors, both driven

```
POST  /api/nutrition/meal-plans                        → 201, stored
PATCH /api/nutrition/meal-plans/meals/[mealId]         → 200, stored
```

Read back from Postgres after the create, for B's plan:

| `name` | `points_at_A_meal` | `points_at_A_mealtype` | `plan_is_B` |
|---|---|---|---|
| Slot | **t** | **t** | t |

### What it does and does not cost

**It does not leak A's data.** The meal-plan read joins neither `saved_meals` nor `meal_types` — the
API returns raw ids, and `savedMealName` / `mealTypeName` came back `null`. That is the half RV-32 had
and this does not, and it is why this is filed below RV-32's severity rather than at it.

**It does let one account mutate another's.** Both columns are `ON DELETE SET NULL`. Driven end to
end:

```
BEFORE  B's plan meal → saved_meal_id = 66d700c9…      (A's saved meal)
        A deletes their own saved meal, through A's own API → 200 {"success":true}
AFTER   B's plan meal → <NULLED>
```

A performed an ordinary action on their own data and a row in B's meal plan changed. Neither account
can see why. This is the same second-order consequence RV-32 recorded for `ON DELETE SET NULL` on the
progression-style edges, reproduced in nutrition.

**The fix is the one `writeSavedMeal` already implements**: verify both ids belong to the caller
before the insert, in the same transaction, and refuse with a 400 naming the field. Do not reach for a
database-level fix — a composite FK carrying `user_id` would work but is a migration on a table two
routes write, where a four-line pre-check in the slice matches what the sibling code already does.

## 5. Filed

| ID | Pillar | What |
|---|---|---|
| **RV-42** | `[nutrition]` `[platform]` | `meal_plan_meals.saved_meal_id` and `.meal_type_id` accept another account's ids through two routes; no data leaks, but `ON DELETE SET NULL` means the referenced row's owner silently nulls the other account's plan |

## 6. Method notes

- **Pair every refusal with a control.** Three of the four clean edges in §3 first produced a 400 for
  an unrelated reason. The refusal and the control differ by one field; nothing else proves the guard
  is the thing that fired.
- **Ask what the read joins before calling a stored cross-user reference a leak.** RV-32's severity
  came from an unscoped join returning another user's *name*. Here the same write defect exists and
  the read carries ids only, so the finding is real and smaller — and saying so is the difference
  between a report and an alarm.
- **`ON DELETE SET NULL` on an unverified FK is a cross-account write primitive.** It is worth
  checking the delete rule on every edge in §2's inventory: `CASCADE` on the same defect would delete
  the other account's row rather than null a column.
- **Re-run the inventory query, never the remembered count.** 27 → 31 in three weeks.
