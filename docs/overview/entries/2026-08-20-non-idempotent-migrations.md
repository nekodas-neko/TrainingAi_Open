# 2026-08-20 — the four migrations that were retried on every cold start (PS-3)

**Branch:** `fix/non-idempotent-migrations` · **Lane A** · closes **PS-3**, files **LA-13**

## What was wrong

`054`, `055`, `082` and `157` each fail on a database that already holds their objects — a bare
`ADD CONSTRAINT`, a second bare `ADD CONSTRAINT`, an unguarded seed `INSERT`, and a `CREATE TABLE`
followed by ten `ADD COLUMN`s. A migration that fails never reaches `schema_migrations`, so all four
were retried on every cold start of the local dev database, forever.

The predecessor session's measurement is what set the scope: production has all four **recorded**
(`claude_ro.schema_migrations`, 206 of 206), so nothing re-runs there and nothing about this change
reaches it. This is a local and CI concern.

## What changed

Each file is now idempotent, using the pattern migration `003` already established:

| File | Guard |
|---|---|
| `054_users_email_unique.sql` | `pg_constraint` NOT EXISTS around the `ADD CONSTRAINT` |
| `055_friends_and_titles.sql` | the same, for `users_friend_code_unique` |
| `082_exercise_library_expand_2.sql` | `ON CONFLICT (name) DO NOTHING` on the 18-row seed |
| `157_scale_ble.sql` | `IF NOT EXISTS` on the table, both indexes and all ten columns |

**`157` is the one that mattered beyond noise.** A multi-statement migration is one implicit
transaction, so its first collision aborted the ten `ADD COLUMN`s behind it — the Postgres twin of
the local-SQLite failure that has left the Android store silently dead twice.

## Measured

- **Fresh database:** 206 applied, 0 failed, 0 already present.
- **The real dev database**, which held four unrecorded migrations: 202 recorded → **206**, 4 applied,
  0 failed. Re-run: 206 skipped, 0 failed. `exercise_library` stayed at 141 rows with zero duplicate
  names, so the seed did not re-insert.
- **Replay against a fully-applied schema** (`TRUNCATE schema_migrations`, run again): **205 of 206**
  apply cleanly.

## The one that does not replay, and why it is left alone

`001_initial.sql` fails that replay with `foreign key constraint "cardio_sessions_user_id_fkey"
cannot be implemented` — `002` renamed the column it references, so replaying `001` onto a modern
schema is incoherent rather than non-idempotent. It only arises by truncating the ledger by hand.

That replay is a check nothing in CI performs: `Migration Check` runs against a **fresh** database,
which is precisely the case where a non-idempotent migration cannot fail. Filed as **LA-13**, with
the `001` exemption recorded on the entry so it is not rediscovered.

## Not exercised

No APK, no native SQLite, no safe-area, no Samsung WebView, and nothing ran against production —
correctly, since production has all four recorded and the edits cannot execute there. Nothing
user-visible changed, so no version bump.
