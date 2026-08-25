# 2026-08-25 — saved meals can say which meals they are (BF-11e)

**Branch:** `feat/saved-meal-meal-type-tags` · **Lane A** · migration **217**, local SQLite **v29**.
No user-visible change yet — BF-11f is the picker.

The owner's report is the whole specification: *"we don't want pancakes recommended for dinner."*
`MealType` is reused as the tag vocabulary rather than inventing a parallel "category": the user
already names and configures their own types with time windows, and a meal can suit several.

## Three decisions, each of which fails silently if taken the other way

**1. `undefined` leaves stored tags alone; `[]` clears them.** The same distinction `imageDataUri`
already draws, and load-bearing for a concrete reason: until BF-11f ships a picker, **every** save
from the saved-meals sheet omits `mealTypeIds`. A `.default([])` on the schema — which `items` has —
would have made tags impossible to keep. It is carried through the shared validator, both routes,
the repository, the outbox replay and the local upsert, because a single link defaulting breaks it.

**2. Soft-deleted meal types are filtered on READ, not deleted from the join table.** `meal_types`
soft-deletes (a food log's `meal_type_id` is `ON DELETE RESTRICT`, so a hard delete cannot work), so
a join row can point at a deleted type. Deleting join rows instead would mean **restoring a type
could not restore its tags**. The filter is one inner join in `listSavedMeals`.

**3. Client-supplied meal-type ids are ownership-verified**, even though `saved_meal_meal_types` has
no `user_id` — its FK proves only that the type *exists*. Same check and same reason as the
food-item one beside it (CLAUDE.md write-path discipline (c)).

## The sync chain, end to end

Traced rather than assumed, and the plan's three constraints all held (line numbers had drifted):
`meal_types` soft-deletes; saved meals reach the device through **`hydrateSavedMeals`, not
`getSyncDelta`**, so tags ride the existing `listSavedMeals` response and there is no pull-delta
branch; and the **push** branch does exist, so route, `pushMutations` and the local table all take
tags here.

**One link is deliberately not wired, and it is recorded in two places.**
`saved-meals-sheet.tsx` still queues a payload with no `mealTypeIds`. That is the correct no-op:
absent means *leave them alone* on both the local upsert and the server replay, while sending the
currently-loaded tags would **revert a change made on another device** between the sheet loading and
the save. There is also no asymmetry for the sync rule to catch — no surface can set a tag today,
web or native. BF-11f's entry now carries the obligation, and so does a comment at the call site.

## What the gates caught that a reading would not have

- **TypeScript** found both local-store mappers the moment `SavedMeal` gained a required field —
  which is the "a missed mapper fails silently as *tags don't save*" hazard the plan names.
- **`check-export-coverage.js`** refused the new table until it was classified in
  `lib/export/export-map.ts`. Scoped through the meal, matching `saved_meal_items`.
- **`claude-ro-readonly-role.test.ts`** would have failed on the view-count divergence; migration
  **218** regenerates the views (87 → 88). It only runs under the **TCP** `DATABASE_URL` — under the
  session hook's socket form it skips, silently, which is exactly the trap `CLAUDE.md` documents.
- **`check-backlog-pointers.js`** caught both stale pointers (migration, SQLite version).

## A defect found in verification, not in review

The first version answered **HTTP 500** for an unknown meal type. That is wrong twice: the client
gets an empty body instead of a message, and **offline it is worse than wrong** — the outbox treats
5xx as *retry* and 4xx as *quarantine*, so a mutation that can never succeed would be retried
forever, which is the queue wedge CLAUDE.md has three production incidents about.

Both write handlers are now wrapped in `withRouteErrors`, and the refusal is a `UserFacingError`.
The sibling `Unknown food item` guard in the same function was converted with it — leaving it would
have meant two refusals of the same class, one line apart, answering 400 and 500.

## Verified

- `saved-meal-meal-types.test.ts` — **10 passed**. **Mutation-proven three ways:** treating
  `undefined` as clear, dropping the ownership check, and dropping the soft-delete filter each fail
  their own tests.
- **The mutation run also found a defect in the test file**, which is why it is worth doing: one
  seeded fault produced *two* failures, and the second was a fixture leak — a test that soft-deletes
  a meal type restored it in its own body, so a body that failed part-way left the next test looking
  at a deleted type. The restore moved to `beforeEach`; re-running the same mutation now fails
  exactly one test.
- Full suite **589 files / 4,831 tests passed**, 0 failures. `pnpm check:rules` **Ran 56 of 56**.
  `tsc --noEmit` clean.
- **Through `pnpm dev`**: POST with a tag stores and returns it; PUT **without** mentioning tags
  keeps them; PUT with `[]` clears them; an unknown meal type and an unknown food item both answer
  **400** with a message; a non-UUID answers 400 from the schema; 21 tags answers 400 from the cap;
  GET carries `mealTypeIds`. Fixtures deleted afterwards.

## Not exercised

- **Nothing on the device, and the local half is the part that cannot be exercised here** —
  `getLocalStore` returns null in the sandbox, so `saved_meal_meal_types`, the v29 upgrade and the
  hydrate path are covered by the schema checks and by reading, not by running. **The v29 upgrade on
  a device that already holds `saved_meals` is the specific thing to watch**: it is a new table, so
  `CREATE TABLE IF NOT EXISTS` does reach upgraded devices (unlike the v27/v28 column case), and
  `RECONCILE_TABLES` is the authority if it half-applies.
- **The migration has not run against production.**
- **No planner reads these tags yet.** Storage and transport only; BF-11f adds the picker and the
  slot matching is later still.
