# 2026-08-20 — the job named Migration Check could not fail on a broken migration

**PR:** #TBD · branch `fix/migrate-classifies-idempotent` · Lane A

## How this was found — and a dedup miss worth recording

**PS-3 already described this**, filed a day earlier by the one-off session whose work landed in
#254 about ninety minutes before I started. My pre-flight check covered branch names and open PRs and
found nothing, because PS-3's branch (`fix/non-idempotent-migrations`) had never been pushed. **What
I did not do was grep the queue for the symptom**, which would have found it instantly. Branch-name
dedup does not catch a finding filed under a different name; searching the backlog for the observed
string does.

The overlap turned out to be partial — PS-3 proposes making the four migrations idempotent, this
fixes the classifier and the CI gate — so both survive, and PS-3 is annotated rather than removed.

Not from the queue, then. The session-start hook printed `[migrate] applied 0, skipped 202 already
recorded, 4 failed` on every session boot, and Q-324's note said the number was *"now 1,
unrelated"*. Chasing that one-line discrepancy is what turned up the rest.

## What was wrong

Two defects that compound, both in `scripts/local-db/migrate.js`:

**It had no error classifier.** `ensureSchema()` in `lib/data/postgres/client.ts` keeps a set of
SQLSTATEs that mean *the object is already there* and steps over them. `migrate.js` had none — so on
any database that already held the objects it reported four already-applied migrations as
**failures**, while `ensureSchema()` read the same four as benign. The file's own docstring says it
*"Mirrors `lib/data/postgres/client.ts`'s `ensureSchema()`"*.

The four, and why each is not idempotent:

| migration | SQLSTATE | why |
|---|---|---|
| `054_users_email_unique` | 42710 | `ALTER TABLE … ADD CONSTRAINT … UNIQUE` — Postgres offers no `IF NOT EXISTS` for it |
| `055_friends_and_titles` | 42710 | same, `users_friend_code_unique`; the rest of the file is guarded |
| `082_exercise_library_expand_2` | 23505 | a seed `INSERT` with no `ON CONFLICT DO NOTHING` |
| `157_scale_ble` | 42P07 | bare `CREATE TABLE`, bare `CREATE INDEX`, bare `ADD COLUMN` |

**And it exited 0 no matter what.** `main()` counted failures and returned. The CI job named
**Migration Check** runs this script and nothing else, so it would print `1 failed` and go green.
Measured before the change: exit code **0** with four failures on the board.

## What changed

- The SQLSTATE list moved to `lib/data/postgres/idempotent-sqlstates.json`, read by both runners.
  `migrate.js` is plain CommonJS that deliberately avoids ts-node, so a shared JSON file is what
  lets the two agree without one importing the other.
- `migrate.js` classifies as `ensureSchema()` does, reports `already present` separately from
  `failed`, and sets `process.exitCode = 1` when anything genuinely fails.

## A thing deliberately not done

**A file that fails idempotently is still not recorded in `schema_migrations`.** Recording it would
stop the retry-every-boot, which is the tempting fix — and it is wrong.
`isIdempotentMigrationError` fires on the **first** statement that collides, and the statements after
it may never have run: migration 157 is a `CREATE TABLE` followed by eight `ALTER TABLE … ADD
COLUMN`s, so recording it on a duplicate-table error could freeze a half-applied migration as done,
permanently. Retrying every boot is noise; recording a partial application is unrecoverable. Both
runners keep the retry.

## Verified

- **The gate fires.** A deliberately broken migration (`SELECT this_column_does_not_exist FROM
  users`) dropped into the directory: `1 failed`, **exit 1**. Removed again: `4 already present, 0
  failed`, exit 0. Before this change both cases exited 0.
- **The two runners now agree verbatim.** `pnpm dev` boots and `ensureSchema` logs `4 already
  present: 054…, 055…, 082…, 157…` — the same four, the same word.
- **The guard is mutation-verified.** Replacing the shared `require` in `migrate.js` with an inline
  copy fails the new test; restoring it passes.
- `scripts/build-rollup-worker.mjs` bundles (the worker imports `client.ts`, so the JSON import had
  to survive esbuild) · `tsc` clean · **Ran 50 of 50 Custom Rules steps** · 4,356 unit tests pass.

## What the gate caught the moment it existed

**CI went red on this very PR, on three jobs at once — and it was right.** `Tests`, `Migration
Check` and `E2E` all run `migrate.js`, and on a fresh database it genuinely fails:

```
[migrate] FAILED 142_claude_ro_views.sql [42P01]: relation "public.db_query_log" does not exist
[migrate] applied 205, skipped 0 already recorded, 0 already present, 1 failed
```

**`142_claude_ro_views.sql` creates a view over `public.db_query_log`. `143_db_query_log.sql`
creates that table.** One migration too late. A multi-statement migration is a single implicit
transaction, so 142 did not fail *partially* — it aborted at that statement and **every view below
it rolled back**.

It was invisible for two compounding reasons, and both are the subject of this PR: `144` rebuilds
the whole `claude_ro` schema, so the end state came out right anyway — and `migrate.js` exited 0, so
all three jobs reported success over it. **This has been happening on every fresh CI database in
three jobs, for as long as 142 has existed.**

The fix is the repo's own rule — *create what you reference in the same migration*. 142 now carries
`CREATE TABLE IF NOT EXISTS public.db_query_log`, matching 143's own `IF NOT EXISTS`, so it is a
no-op on every database that already has the table, which is all of them but a fresh one.

| fresh database | before | after |
|---|---|---|
| `migrate.js` | 205 applied, **1 failed**, exit 0 | **206 applied, 0 failed**, exit 0 |
| re-run | — | 206 skipped, 0 failed |
| `claude_ro` views | 85 | 85 — unchanged, confirming 144+ were rebuilding them |

**Production is untouched:** 142 is already recorded there, so the new statement never runs.

## PS-3's open question, answered

That entry says: *"What needs establishing before any fix is whether the same four are unrecorded in
production"*, because `ensureSchema` tracks by filename and an unrecorded migration re-runs on every
cold start.

**They are recorded.** `claude_ro.schema_migrations` holds **206 of 206** filenames — `054`, `055`
and `082` stamped 2026-07-21, `157` on 2026-07-28. Production skips all four; this is local-only.

## Honest limits

- **The four migrations are left non-idempotent**, so they are still retried on every local cold
  start — four statements that now fail cleanly and are reported as benign. Making them idempotent
  would let them record and end the retry; with production clean it buys quiet and nothing else.
  PS-3 stays in the queue for that, rewritten with this measurement.
- **The CI gate is not proven in CI.** It is proven locally on both branches of the condition. CI
  applies to a fresh database where all 206 succeed, so the failing branch cannot be exercised there
  without deliberately breaking a migration on `main`.
- **Not exercised:** APK, native SQLite, safe-area, Samsung WebView. Nothing user-facing changed; no
  version bump.
