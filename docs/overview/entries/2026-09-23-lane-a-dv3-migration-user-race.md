# 2026-09-23 — DV-3: the advisory lock was the wrong lock, and the race is reproducible

**Branch:** `lane-a/dv3-migration-user-race` · **Lane A** · test infrastructure only. No product code,
no migration, no schema change.

## What DV-3 reported

One CI failure on PR #1419 (a docs-only change): `Tests` red with
`insert or update on table "exercise_estimates" violates foreign key constraint
"exercise_estimates_user_id_fkey"`, 1 file of 997, **green on re-run**. The entry was explicit that
it had read the test rather than reproduced it, and named three possible fixes.

## Two of the three suggested fixes were unavailable, and the third was already in place

- *"take the same advisory lock the migration runner uses"* — **the test already takes it.**
  `personal-records-reconcile-migration.test.ts` has used `migrationTestLock` since Q-171.
- *"move it to the `rollup`-style serial project"* — **there is no serial project.** `vitest.config.ts`
  has `rollup` and `unit`; `rollup` differs only in its 60 s timeout, and both run files in parallel
  workers.
- *"scope what it runs to its own users"* — possible, but `migration-test-lock.ts`'s own header
  argues against scoping a data migration, since table-wide is what it is for.

## What the advisory lock actually covers, and the gap

It serialises **migration tests against each other** — sixteen files take the key. It says nothing
about ordinary tests. Measured: **171 test files run `DELETE FROM users`; nine of them take the
lock.** The other 162 can delete a user at any moment.

Migrations **163 and 164** both carry
`INSERT INTO exercise_estimates … SELECT … FROM personal_records` with no user filter. At READ
COMMITTED the `INSERT … SELECT` fixes its snapshot at statement start, so it reads a foreign user's
`personal_records` rows, blocks on the referential-integrity check while that user's `DELETE` is
still uncommitted, and fails the moment the delete commits.

## Reproduced, not inferred

Hold an uncommitted `DELETE FROM users` on a second connection, start the migration, wait until it
is **observably blocked** (polled from `pg_stat_activity`, not slept on), then commit the delete.

| | result |
|---|---|
| `pool.query(sql)` | `23503 exercise_estimates_user_id_fkey`, **3 of 3** |
| `LOCK TABLE users IN SHARE MODE` first | green, **3 of 3** |

## The fix

`runMigrationSql(pool, sql)` in `migration-test-lock.ts` prepends `LOCK TABLE users IN SHARE MODE`
to the migration, inside the same implicit transaction that `pool.query` of a multi-statement
string already creates. Adopted by **both** exposed files — `personal-records-reconcile` (the one
DV-3 named) and `cable-exercise-merge`, which carries the identical INSERT and is the file Q-171
already recorded failing one run in three.

`SHARE` is the weakest mode that conflicts with the `ROW EXCLUSIVE` a `DELETE` takes, and it is
self-compatible, so migration tests do not block each other on it. Taking it **first** is what keeps
it deadlock-free: ordinary tests hold only their own short `DELETE FROM users` lock and never wait
on a table this transaction already holds.

Not a retry — Q-171 forbids it, and DV-3 repeated the prohibition.

## Mutation pass

| # | mutation | result |
|---|---|---|
| 1 | lock removed entirely | killed — FK violation returns |
| 2 | weakened to `ACCESS SHARE` (does not conflict with `DELETE`) | killed |
| C | strengthened to `EXCLUSIVE` (still conflicts) | **survived** (correct) |

Mutant 2 is the one worth keeping: it proves the test pins the lock's **conflict semantics** rather
than the word `SHARE`, so a future "tidy-up" to a weaker mode cannot pass.

## Not done, and a residual risk stated plainly

- **The other 162 `DELETE FROM users` files are untouched.** This closes the two migrations that
  insert into a user-referencing table; it does not make the shared test database safe in general.
- **Deadlock is reduced, not proven impossible.** A test that deleted a user *and* wrote a
  migration-touched table inside one explicit transaction could still deadlock with this lock
  ordering. None does today. Postgres would detect it rather than hang.
- **Failure surfaces not exercised:** none that apply — this is test infrastructure, runs only
  against a real Postgres, and touches no product code, no device path and no UI.
