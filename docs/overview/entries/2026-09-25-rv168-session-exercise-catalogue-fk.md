# RV-168 — the catalogue join key that every program save emptied

**Branch:** `fix/session-exercise-catalogue-fk` · **Lane A** · `[workouts][platform]`

## What was wrong

Migration 099 added `session_exercises.exercise_id`, called it *"the join key"* in its own header
comment, and backfilled it from `exercise_library` by name. Nothing kept it filled. `saveProgram`
expresses a program edit as a delete of the session's exercise rows followed by a re-insert, and
the re-insert never carried the column — so every save reset it to NULL for every exercise in
every session it touched.

The only writer left was the Coach swap, which sets the FK when it replaces an exercise. That is
exactly the distribution review sweep 57 found in production: the active program **Bankai at 0 of
25**, the others at 1 of 25, 2 of 25 and 1 of 17, and only "Main" — last saved 06-28, before the
Coach existed in its current form — at 20 of 20.

**Nothing is broken today**, and the entry said so. Programs resolve exercises by name, and
`exercise_logs.exercise_id` is 100% filled with 0 mismatches. This is Q-474's trap rather than a
live fault: a column documented as the join key, empty in practice, so the first thing that ever
joins on it returns nothing and looks like a data problem.

## The choice: populate, not mark dead

The entry offered both — fill it in `saveProgram`, or mark it dead the way `unusedProgramSessionId`
was. Populating, for three reasons:

1. **Marking it dead is the bigger, riskier diff.** The Coach maintains this FK deliberately:
   `captureBefore` stores it so `undo` can restore it, with a comment recording the 2026-08-09 bug
   where an undo restored only the display name and left `exercise_id` pointing at the replacement.
   Killing the column means deleting that, and ends in a `DROP COLUMN` migration — the owner's call,
   not a lane's.
2. **The FK is strictly more robust than the name.** `exercise_library.name` is unique but mutable;
   a rename silently orphans every name-matched row, and a filled FK survives it. The library even
   plans for this — `merged_into` exists precisely so "historical `exercise_id` FKs stay valid".
3. **It makes a documented invariant true** instead of leaving a second thing to remember.

Reversal cost either way is one lookup in one function.

## What shipped

`saveProgram` resolves the FK for the rows it inserts, in **one batched query** over the distinct
exercise names rather than a round trip per row — a program save inserts ~25 of them. The
resolution is migration 099's, unchanged: exact, case-sensitive match on the library's unique name,
NULL when there is no match.

Two subtleties worth recording rather than rediscovering:

- **`exerciseId` means two different things three lines apart.** The name destructured from
  `sessionsWithIds` is the row's **own primary key**; the `exerciseId:` column being written is the
  **catalogue FK**. Both are in the same object literal. A comment now says so at the site.
- **A merged-away catalogue row still matches, and that is deliberate.** `merged_into` is not
  filtered here, because neither `resolveExerciseId` nor the Coach's own lookup filters it. Adding
  the filter in this one place would give the app two different answers to "which row does this
  name mean". If merge-following is wanted it belongs in a shared resolver, changed everywhere at
  once.

## Verification

`lib/data/postgres/__tests__/save-program-exercise-fk.test.ts`, 5 cases: a name in the library
links; two names link to their own rows rather than the first found; a name the library lacks stays
NULL; matching is case-sensitive; and — the one that pins the actual regression — **the FK is still
there after a re-save**, which is the delete + re-insert path. A first save filling the column
proves nothing if the next save empties it.

Mutation pass, all against the real local Postgres:

| mutation | killed |
|---|---|
| drop the `exerciseId:` assignment (the original bug) | 4 of 5 |
| match case-insensitively instead of 099's exact match | 1 of 5 — exactly the case-sensitivity case |
| link every exercise to the first library row found | 3 of 5 |
| **control:** drop the `new Set` dedupe from the name list | **0 — survived, as intended** |

A first attempt at the case-insensitive mutation failed all 5, which meant it had errored rather
than changed behaviour; re-run as `inArray(sql\`lower(name)\`, …)` it kills the one case it should.
A sixth test asserting the batch (counting `pool.query` calls) was **written and then deleted** —
`saveProgram` runs in a transaction, so its queries go through `client.query` and the probe could
never have failed.

**Exercised through the real route, not just the slice.** Four Playwright specs that drive program
edits — `get-ready-timer`, `session-delete-confirm`, `same-named-sessions-one-day`,
`rv81-one-exercise-datalist` — were run against the dev server through the harness's real
sign-in, 6 passed. Reading the database afterwards: **8 of 9 live rows linked, 0 FKs pointing at a
row whose name differs from `exercise_name`.** The one NULL is `Bicep Curl`, which genuinely has no
`exercise_library` row — a correct NULL rather than a miss. That is the end-to-end confirmation the
unit tests cannot give, since they call `saveProgram` directly.

Gates: `tsc --noEmit` clean · `typecheck:tests` none above baseline · lint 0 errors ·
**Ran 78 of 78 Custom Rules steps** · the 8 program/coach test files that touch this path, 148
passed · **full suite 1058 files / 9838 tests passed, 5 files and 87 tests skipped**.

## Not exercised

Server-side only. `session_exercises.exercise_id` is **not** in the device mirror — neither the
local SQLite table nor the pull delta carries it — so there is no local-store change, no schema
version bump and nothing for the device to verify. No user-visible behaviour changes, so no version
or changelog bump.

Named explicitly, per the failure-surface rule: the **APK was not run** (nothing reaches it — the
column never leaves the server); the **Coach swap was not driven by hand**, only by its own
148-test surface, which is green; and the e2e run is the **web** build, where `getLocalStore`
returns null, so it says nothing about the device branch. None of those are paths this change can
reach, which is why they were not chased.

## Left open

**LA-143** (`Gate: owner`): the rows saved *before* this fix are still NULL and fill in on their own
the next time each program is saved. A one-statement backfill — migration 099's own `UPDATE`,
`WHERE exercise_id IS NULL` so it cannot overwrite a Coach-set value — would do it at once. It is
recommended and it is not in this PR for one reason only: it writes production rows.
