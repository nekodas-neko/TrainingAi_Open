# 2026-09-28 — LA-143: `session_exercises.exercise_id` backfilled, under the add/backfill policy

RV-168 made `saveProgram` fill the foreign key, but rows saved before it stayed NULL: 88 of the owner's
112. Migration 295 is migration 099's backfill re-run `WHERE exercise_id IS NULL`, so it cannot
overwrite a Coach-set value. `exercise_library.name` is UNIQUE, so the match is never ambiguous.

The policy's two conditions (OR-182), met as follows:

- **Snapshot, taken and restored.** The pre-image, the 88 NULL ids, was saved before merge. The whole
  loop was rehearsed on the owner's real data (a snapshot database): 88 NULL → 0, the restore from
  the pre-image touched exactly 88, re-applying filled them again, and a second run was a no-op.
- **Count against prediction.** The prediction is 88 for the owner. The migration also checks
  itself: it counts the matchable NULL rows immediately before the UPDATE and raises, rolling
  back, if the UPDATE touches a different number. Dropping `IS NULL` from the UPDATE makes it raise,
  which the test's mutation run showed.

**Owed after deploy:** read the owner's rows in production and expect 0 NULL where 88 were. The undo,
if it is ever wanted, is `SET exercise_id = NULL` on the saved ids.
