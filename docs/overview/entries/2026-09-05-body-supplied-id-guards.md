# A body-supplied id gets an answer that means what it says (RV-47, RV-48)

**Branch:** `fix/rv47-rv48-body-id-guards` · **Lane:** A · **Domain:** platform / nutrition
**Version:** 1.436.9

Sweep 48 asked of `PUT`/`PATCH` what sweep 47 asked of `DELETE`, and found the update surface sound
wherever the id is a path parameter — all thirteen dynamic routes 404 correctly and refuse another
account's row — and unsound wherever it arrives in the body. `invalidUuidResponse`, the guard Q-482
added after 21 route/method pairs answered 5xx on a malformed id, had reached **27 of 27** dynamic
`[id]` routes and **zero** body-id ones.

## RV-47 — a malformed id reached the driver

Five routes now check the id's format before any query runs: `PATCH /api/admin/exercises`, `PATCH`
and `DELETE /api/admin/users`, `PATCH /api/nutrition/meal-types` (every entry of `orderedIds`), and
`DELETE /api/workout-entry`.

The last one is not in the review. Its probes were `PATCH`-only, and `workout-entry`'s `PATCH` was
the write-up's own reference for the fix — `.uuid()` on `exerciseLogId` in its Zod schema. Its
`DELETE` parses the body by hand a hundred lines further down and had nothing. The route the review
held up as already-correct was half correct.

**Two of the review's five routes deliberately did not get the guard, and that is the part worth
keeping.** `oura_workouts.id` and `activity_types.id` are `text`, not `uuid`. A malformed value
there can never raise `22P02`, so there is no 500 to fix — and applying the helper anyway is exactly
BF-53, where the `[id]` sweep put a uuid regex in front of two `bigserial` routes and killed the
whole pending weigh-in triage in production: a reading that was not the owner's could not be
dismissed, one that was could not be confirmed. **The column type decides which routes are in the
class, not the route list.** Read the schema before applying a guard named after a format.

## RV-48 — an update that matched nothing reported success

Five repository methods report their match through `.returning()` instead of resolving to `void`:
`activateUser`, `deactivateUser`, `deleteUser`, `deleteExercise`, `markOuraWorkoutReviewed`. The two
`admin` deletes are RV-45's class on the surface that sweep did not cover; they were two lines each
in files already open, and leaving one delete in a file inconsistent with its sibling is what the
sibling-surface rule exists to stop.

**`reorderMealTypes` changed behaviour, not just its status, and that is a real decision.** Every
update inside it was already owner-scoped, so a foreign or stale id matched nothing and the
transaction committed the rest: the client's *partial* order was stored and reported as success. It
now checks the whole list against the user's live meal types inside the transaction and applies all
of it or none.

All-or-nothing rather than best-effort because a short list means the client is holding meal types
that no longer exist — a row deleted on another device is the realistic route there — and the order
it computed from that stale list is not the order the user would have chosen from the real one.
Applying the matching part commits an arrangement nobody asked for and calls it a success; refusing
tells the client to refetch, which is the only thing that can actually fix it.

## What the fix is worth on each surface

Three of the four client surfaces already do `if (!res.ok) throw`: `admin-content.tsx` for both user
actions and `exercise-manager.tsx` for the delete. Those now show "Action failed" instead of
updating local state to a lie, with no client change at all.

The fourth does not. `meal-type-manager.tsx`'s `handleDragEnd` is
`fetch(...).then(() => invalidateMealTypes()).catch(...)`, and a `fetch` promise does not reject on
a 4xx — so the `.then` runs for every response the server sends. Filed as **LA-59** for Lane B; the
fix is `if (!res.ok)` and then a refetch rather than only a toast, because a 404 there means the
list the drag was computed from is stale. The two Oura `PATCH` callers are deliberately
fire-and-forget and stay that way.

## Verification

- `tsc --noEmit` clean · full suite **760 passed | 5 skipped (765 files), 6468 tests** ·
  `pnpm check:rules` **68 of 68**
- New `lib/data/postgres/__tests__/body-supplied-id-guards.test.ts`, 12 cases against the local
  Postgres. Two ids, not one: `ABSENT_ID` is well-formed and belongs to nobody (the RV-48 path),
  `MALFORMED` is not a uuid (RV-47). Asserting 404 with a malformed id would pass on a route with no
  not-found path at all, because the guard answers first.
- The reorder carries a positive control — a real three-item reorder applies and the stored order
  reads `C, A, B` — beside the refusal case, which asserts the stored order is *completely*
  untouched. Without the control, 404 proves nothing: a route that refuses everything also refuses a
  ghost id.
- Mutation-verified three ways. Dropping the `admin/users` guard failed exactly one test by name;
  making the reorder best-effort again and removing the Oura 404 failed exactly two, the right two.
- All seven changed routes load and fail closed on `pnpm dev` (401/403 unauthenticated).

**Not exercised:** nothing native, safe-area or Samsung-WebView is in scope — these are server
routes. No production data was read. The `oura/workouts` 404 is verified against a locally seeded
absence rather than a real workout, because `oura_workouts` holds no rows locally; the review
recorded the same gap as **not established** rather than asserting it.
