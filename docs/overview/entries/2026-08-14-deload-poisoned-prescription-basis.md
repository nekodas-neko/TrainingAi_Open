# 2026-08-14 — a deloaded log can no longer become a prescription basis (Q-228)

**Branch:** `claude/trainingai-backlog-v0abea`

Owner, mid-workout, caught before loading the bar: *"could you review the phase change and the weight
and load increase — it feels like its much too much."* Incline Bench Press, prescribed **72.5 kg (83%
of an 86.25 kg 1RM)** against a "last session" display of 42.5×8 / 42.5×11.

Those 42.5 kg sets were a whole-session AI deload at `planned_pct: 52` — the Q-115 corruption.
Migration 168 (2026-08-07) corrected four of the five exercises from that session, auditing the
21:47–22:09 UTC window. **Incline Bench Press was exercise 1 of the same session, logged at 21:41:20,
six minutes before the window opened, and was never touched.** It still carried the contradiction:
`exercise_deloaded = true` alongside `estimated_1rm = 85.75`.

## The structural half, which is the part that matters

`getLastRealOneRmBatch` — the query `resolveWorkingBasis` builds `lastNonDeload1rm` from — selects
the most recent log with `estimated_1rm > 0` and **never filtered on `exercise_deloaded` at all**. It
relied entirely on the write-time invariant that a deload always stores 0.

That invariant is a claim about the write path, not a property of the data, and production disproves
it. Its sibling `reconcilePersonalRecord` in the same file already carries
`eq(exerciseLogs.exerciseDeloaded, false)` with the comment *"mirrors shouldCountTowardPr's
per-exercise deload gate"*. This query was the one place missing it, so any future write-time
regression — or any other missed straggler — reached the bar with no read-time backstop. One line,
plus the reasoning next to it.

## What is honestly true today

**The symptom has already self-cleared, and saying otherwise would be wrong.** The owner logged a
real Incline Bench Press set on **2026-08-13 at `estimated_1rm = 76.5`**, which is newer than the
straggler, so `getLastRealOneRmBatch`'s `DISTINCT ON` already resolves past it. Verified in
production: exactly **one** row in the owner's history has `exercise_deloaded = true` with
`estimated_1rm > 0`, and it is shadowed. No exercise currently resolves to a poisoned basis.

So this PR changes no number the owner will see tomorrow. It closes the gap that produced the number
they saw last week, and cleans up the row that produced it. That is worth doing on its own terms, but
it is defence and hygiene, not a live fix — the backlog entry was written while the symptom was live
and this is the state four days on.

`claude_ro` is row-scoped to one user, so "exactly one row" is a statement about the owner's history.

## Migration 186

Zeroes **both** `estimated_1rm` and `target_80` on that row. The second column is the addition the
entry missed: `getLastRealOneRmBatch`'s own doc comment says a deload row stores 0 in `target_80`
too — it is the displayed target *and* the weight the dial pre-fills to, so a stored 44.5 there is
the same lie one field along. Migration 168 only needed to clear `estimated_1rm` because its four
rows already had `target_80 = 0`.

**No `personal_records` correction, unlike 168.** `shouldCountTowardPr` does check
`exercise_deloaded`, so this row never reached that table — the PR is 78.75 from 2026-07-30, which is
correct. Confirmed by query rather than assumed.

The WHERE matches on name + flag + exact value + a two-hour window, expressed over values rather than
a user id, so it is a no-op on any database that never held the row, and idempotent.

## Verified

Three new cases on the query and four on the migration.

**Mutation-verified, four ways.** Removing the `exercise_deloaded` filter fails 3 query cases;
weakening it to `IS NOT NULL` fails the same 3. Dropping `target_80 = 0` from the migration fails 1;
dropping the flag from its WHERE fails the case that seeds an unflagged row with identical values —
matching on the value alone would reach a legitimate 85.75 in the same hour.

The migration test asserts `rowCount === 0` on a second run, so idempotence is measured rather than
argued.

Full suite green — **462 files, 3,823 tests**. `tsc --noEmit` clean, lint 0 errors,
`pnpm check:rules` 33 of 33.

**Reproduced and fixed on the live route, not just in the query's own test.** Migration 186 applied
on the dev server's cold start via `ensureSchema` (confirmed in `schema_migrations`). Then, with a
`exercise_deloaded = true, estimated_1rm = 999, target_80 = 799` row inserted as the newest log for
Barbell Bench Press, an authenticated `GET /api/workout-data?tab=<sessionId>` returned the real basis:
**98 / 80**. Reverting just the one filter line and repeating the same request returned **999 / 799**
— the owner's bug, on the actual endpoint, in both directions. Fixture removed and the line restored
afterwards.

**One thing the test file had to admit.** Its header claimed *"`estimated_1rm > 0` IS the deload test
rather than a proxy"* — one predicate that cannot fall out of sync with the three deload markers.
That was true of the write path and false of the stored rows. The comment now says so.

**Confirmed in production, 2026-08-14 after the merge.** v1.306.2 deployed, migration 186 present in
`schema_migrations`, and the row reads `estimated_1rm = 0`, `target_80 = 0` with `exercise_deloaded`
still true. **Zero** rows in the owner's history now carry `exercise_deloaded = true` with
`estimated_1rm > 0`.

One thing worth writing down because it briefly read as a failure: a query fired seconds after the
merge still returned 85.75 / 44.5. `ensureSchema` applies migrations on **cold start**, not on merge,
so there is a window where `main` carries the migration and the running container has not applied it.
Check `/api/version` for the new version before concluding a corrective migration did not work — and
`schema_migrations` before concluding its SQL is wrong.

**Not exercised:** the S25. Nothing here is device-shaped; the prescribed numbers arrive from the
server either way.
