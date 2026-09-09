# 2026-09-09 — a removed training session is now tombstoned, not deleted (LB-66)

**Branch:** `feat/lb66-program-session-tombstones` · migration **271**, shipping alone.

## What was actually wrong, beyond "no `deleted_at`"

There is no delete endpoint for a program session. Removing one is expressed as *saving the program
without it*, and `saveProgram` hard-deleted **every** session and session-exercise of the program
inside a transaction and re-inserted them, round-tripping the client's ids. So the deletion was
never a `DELETE` anyone could point at — it was an absence from the re-insert.

That mattered more than the missing recovery path, because two FKs fired on the way out:

- `workout_sessions.session_id` **and** `program_session_id` are `ON DELETE SET NULL`, so months of
  logged workouts were severed from the session they were trained under.
- `session_periodization.program_session_id` is `ON DELETE CASCADE`, so the removed session's
  phase and cycle state was destroyed outright.

Both now survive, because nothing fires on a tombstone.

## The unique constraints are why this is a constraint swap, not an `ADD COLUMN`

`program_sessions (program_id, position)` and `session_exercises (session_id, position)` were plain
`UNIQUE`. Delete the middle session of three and the client re-saves the survivors compacted to
positions 0 and 1 — while the tombstone still holds position 1. **Every deletion of a non-last
session would have been a `23505`.** Migration 271 drops both constraints and recreates them as
partial unique indexes `WHERE deleted_at IS NULL`, which is the standard soft-delete shape and keeps
the constraint exactly where it still means something. Nothing is dropped, no existing row fails the
new predicate, and a corrective migration can put the constraints back.

## The split, and the one reading that would have shipped the bug

Replacing the two `delete`s with a soft delete tombstones the **whole program on every save** — the
failure the entry was reconciled to name. What is real is only the ids that do *not* come back:

```
removed  = live rows whose id the save did not supply   -> tombstone
replaced = any row (live or tombstoned) the save supplied -> hard delete + re-insert
```

`replaced` spans tombstoned rows so a **resurrection** works: saving a removed session's id back
deletes the tombstone first, then re-inserts on the same primary key. That also forced the RV-34
"belongs to another program" guard to widen from live ids to *all* of this program's ids — otherwise
a resurrection reads as someone else's session and 409s.

## Two things the FK used to do for free

- **Schedule days.** `schedule_days.session_id` is `ON DELETE SET NULL`; the delete cleared the slot
  and the tombstone does not. Two separate guards cover two separate cases, and mutation testing
  confirmed neither is redundant: an explicit clear (for a save that omits `schedule` entirely, where
  the rebuild below never runs) and a filter on the schedule re-insert (for a stale client that names
  the session it is removing in the same save).
- **The workout-link restore.** The capture of orphaned workouts narrowed to `replaced` only. Left at
  the old "all live ids", the pre-id **position fallback** re-attributes a removed session's workouts
  to whichever session compacted into its slot — a mis-attribution, not a preservation.

## No local SQLite change, and the reason is worth keeping

The pull delta re-sends a changed program's whole subtree and the client **deletes every child by
program id before re-inserting**. So filtering the delta to live rows is the entire propagation
mechanism: a tombstoned session is simply absent from the replacement and disappears on the device.
No `deleted_at` in the mirror, no v39.

That works only while every tombstoning write bumps `programs.updated_at`, which is what puts the
program in the delta at all. `saveProgram` already did; the two single-row removal paths
(`removeSessionExercise`, the Coach's `removed` patch) did not, and now do. **Without that bump the
tombstone would be strictly worse than the hard delete** — invisible on the server *and* never
propagated.

## Read sweep

`deleted_at IS NULL` added to the program read (`listPrograms`, both levels), the save's own
`oldSessions`, the ownership lookup behind `removeSessionExercise`, the legacy-workout name map in
`countAllSessionsSinceStart`, `listSessionPeriodizationForProgram`, `clearProgramPrescriptions`, the
`reconcileSessionsInPhase` raw SQL, the Coach's `loadTarget`, the injury and program-phase exercise
reads, and both halves of the sync delta.

Deliberately **not** filtered: the workout-history joins that read a session's *name* for an already
logged workout (a tombstone now supplies it where the old hard delete forced a fallback), the
`programId`-scoped workout-history subqueries (workouts trained under a since-removed session still
belong to that program), and the data export (recovery is the point).

## Verification

14 cases in `lib/data/postgres/__tests__/program-session-tombstone.test.ts`. Mutation pass: **15 of
15 real mutants caught**, one deliberately equivalent control (removing an outer length guard whose
two inner branches are already length-guarded) survived as expected. Three mutants survived the first
pass — the schedule clear, the exercise-level read filter, and the workout capture — each a real gap,
each now separated by its own fixture rather than by an assertion added to a fixture that could not
tell the two guards apart.

## The green local suite was wrong twice, and CI caught the second one

**`claude_ro` views are an explicit column list, so a new column is invisible until they are
rebuilt.** Migration 271 added two; `db-snapshot-integration.test.ts`'s drift check exists to catch
exactly that, and it **skips locally** — it gates on `isTcpUrl(DATABASE_URL)` because it provisions a
real read-only role over a password login, and the value the container provisions is the Unix-socket
form. So the local suite ran 27 fewer tests than CI and the `Tests` job went red on a green local
run. Migration **272** is the regenerated views; diffed against 268, it differs by exactly
`program_sessions.deleted_at` and `session_exercises.deleted_at` and nothing else.

Reproduced before fixing, per the drive-to-green rule: the same file over
`postgresql://postgres:postgres@localhost:5433/trainingai_dev` fails with CI's exact message, and
passes with 272 applied (37 of 37 across all four `claude_ro` files).

## A false green found on the way, worth more than the entry it interrupted

`pnpm ci:local` from a session shell reported **678 passed / 191 skipped files** and exited 0 — while
the same tree run as `DATABASE_URL=… pnpm test` reported **862 passed / 5 skipped** and surfaced
**four real failures**, including in this PR's own new file. The container provisions `DATABASE_URL`
pointing at production, so `session-start.sh` unsets it (correctly — otherwise `pnpm dev` talks to
prod), and nothing in `vitest.config.ts`/`vitest.setup.ts` loads `.env.local` back. Every DB-backed
file then hits `describe.skipIf(!canRun)` and skips silently; the skip count is the only tell.
Recorded in [`docs/local-dev-database.md`](../../local-dev-database.md) with both measurements, and
beside it the socket-vs-TCP gap above — **the local command to trust is
`DATABASE_URL=postgresql://postgres:postgres@localhost:5433/trainingai_dev pnpm test`**, which is
what closes both.

**Not exercised:** the APK. This is server-side only, so it reaches the device through a Railway
deploy with no rebuild — but the on-device sync that turns a tombstone into a disappeared session in
the config editor has not been run on hardware.
