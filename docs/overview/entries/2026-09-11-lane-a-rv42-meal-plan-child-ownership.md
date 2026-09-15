# RV-42 — a plan meal could point at another account's rows

**Branch:** `lane-a/rv42-meal-plan-child-ownership` · **Lane A** · no migration, no native change.

## The defect

`meal_plan_meals` carries `meal_type_id` and `saved_meal_id`, both client-supplied, both reaching
tables whose FK proves only that the row exists. The table has no `user_id`, so the FK was the only
ownership link — and it links nothing about ownership. `ownedPlan` guarded the *plan* id and the
child ids went in unchecked. CLAUDE.md's write-path ownership discipline (c), exactly.

**Nothing leaked.** The meal-plan read joins neither table and returns raw ids. The cost ran the
other way: both columns are `ON DELETE SET NULL`, so the owner deleting their own saved meal
silently nulled a stranger's plan meal, with neither account able to see why.

## Where the entry was wrong

**Three write paths, not two, and no shared choke point.** RV-42 named
`replaceMealPlanStructure` "and the create path" and said *"the fix is one pre-check, not two."*
`createMealPlan`, `updateMealPlanMeal` and `replaceMealPlanStructure` each do their own insert or
update; there is nowhere that one check would have covered all three.

**And the one route the entry named is the one that was never exploitable.** The structure route's
`.strict()` schema accepts `mealsPerDay`, `trainingTime`, `retarget` and `order` — no meal fields at
all — and builds its variants by carrying the ids forward from the plan's *existing* rows. Driven
over HTTP it answers `Invalid body` before reaching the repository. **The live doors were the create
POST and the meal PATCH.** The guard on `replaceMealPlanStructure` is kept as defence-in-depth,
because it is a repository function that writes those columns and the discipline belongs at the
write path, not because it closed a hole.

## What shipped

One helper, `assertOwnedMealRefs`, on all three paths. It takes `Pick<Db, 'select'>` so two callers
can run it inside the transaction that does the insert — placed *before* the first write in the
create path, and before the delete in the replace path, so a refusal leaves the existing structure
intact. Meal types are checked with `isNull(deletedAt)` and saved meals without, matching
`writeSavedMeal`, whose shape the entry correctly said to copy; `saved_meals` has no `deleted_at`.

**The routes needed fixing too, and the entry did not mention it.** All three called the repository
with no try/catch, so a `UserFacingError` would have reached Next's default handler as a **500** and
landed in `error_events` — the opposite of the 400 the entry asked for. They now go through
`withRouteErrors`/`routeErrorResponse`.

The file header claimed *"every write in this file goes through `assertPlanOwned` or a user-scoped
predicate; none of them trust an id from the request."* True of the plan id, false of the ids a meal
points at. Corrected in place.

## Verification

Seven DB tests across all three paths, two accounts. Mutation pass: each of the three guards removed
separately and the user scope dropped from the saved-meal check — **four mutants, all killed**; one
deliberately equivalent control (`!==` → `<` on a de-duplicated set) survived as it should.

Driven end to end against `pnpm dev` with two accounts: the create POST and the meal PATCH both
answer **400** naming the field (`Unknown saved meal` / `Unknown meal type`), a create naming the
caller's own rows still returns **201** with both ids stored, and an explicit `null` still clears a
reference. `meal_plan_meals` holds zero cross-account rows after every probe.

## Not exercised

No device path and no APK — server-side write paths only. The structure route's refusal was proven
at the repository and by mutation, not over HTTP: its schema rejects the request first, which is the
finding above rather than a gap in coverage.
