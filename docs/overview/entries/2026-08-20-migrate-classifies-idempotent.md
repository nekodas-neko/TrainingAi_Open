# 2026-08-20 — the job named Migration Check could not fail on a broken migration

**PR:** #TBD · branch `fix/migrate-classifies-idempotent` · Lane A

## How this was found

Not from the queue. The session-start hook printed `[migrate] applied 0, skipped 202 already
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

## Honest limits

- **The four migrations are left non-idempotent.** Making them so means editing already-applied
  files, which changes nothing for any database that has them and is safe — but it is a separate,
  larger judgement than this fix, and the retry is harmless. Not filed as a queue entry because the
  classifier change removes the symptom that would have justified it; if a fifth appears, that is
  the moment.
- **The CI gate is not proven in CI.** It is proven locally on both branches of the condition. CI
  applies to a fresh database where all 206 succeed, so the failing branch cannot be exercised there
  without deliberately breaking a migration on `main`.
- **Not exercised:** APK, native SQLite, safe-area, Samsung WebView. Nothing user-facing changed; no
  version bump.
