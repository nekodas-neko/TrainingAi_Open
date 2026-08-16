# 2026-08-08 — `ensureSchema` stops filing a real failure as noise (Q-152), and what that exposed

**Branch:** `fix/ensure-schema-error-classification` · **Domain:** `platform` · no version bump
(server boot logging, nothing user-visible)

## What was wrong

`ensureSchema` re-runs every migration absent from `schema_migrations`, so on a live database most of
those attempts fail on purpose — the object is already there. Every failure, expected or not, went
through one `console.warn` in one format:

```
[ensureSchema] 001_initial.sql: foreign key constraint "cardio_sessions_user_id_fkey" cannot be implemented
[ensureSchema] 054_users_email_unique.sql: relation "users_email_unique" already exists
[ensureSchema] 055_friends_and_titles.sql: relation "users_friend_code_unique" already exists
[ensureSchema] 082_exercise_library_expand_2.sql: duplicate key value violates unique constraint "exercise_library_name_key"
[ensureSchema] 157_scale_ble.sql: relation "scale_raw_samples" already exists
[ensureSchema] 0 migration(s) applied
```

Four of those are idempotency notices. The first is a constraint that could not be created. They read
identically, and the trailing `0 migration(s) applied` invites skimming the whole block as startup
noise.

## What changed

Classification by **SQLSTATE**, not message text — the messages are English prose that varies by
object type and server version; the code is part of the wire protocol.

`isIdempotentMigrationError` treats six codes as benign: `42P07` duplicate_table (covers indexes and
views), `42710` duplicate_object, `42701` duplicate_column, `42P06` duplicate_schema, `42723`
duplicate_function, `23505` unique_violation. Anything else — **including an error with no code at
all** — is a genuine failure. Classifying the unknown as benign is how the original bug read.

The same boot now prints:

```
[ensureSchema] FAILED 001_initial.sql [42804]: foreign key constraint "cardio_sessions_user_id_fkey" cannot be implemented
[ensureSchema] 4 already present: 054_users_email_unique.sql, 055_friends_and_titles.sql, 082_exercise_library_expand_2.sql, 157_scale_ble.sql
[ensureSchema] 0 applied, 4 already present, 1 failed
[ensureSchema] 1 migration(s) DID NOT APPLY: 001_initial.sql [42804]
```

**Deliberately not fatal.** A migration that cannot apply is usually permanent — a file that can no
longer produce its schema — so failing closed would crash-loop every boot in production rather than
surface anything new. CLAUDE.md's connection-pool section exists because a crash loop took
production down once already. Loud and non-fatal is the trade, and the summary line means a
non-zero count cannot be skimmed past.

## What it exposed — filed as Q-159

Once the line was legible, it was worth reading. `001_initial.sql:145` declares
`cardio_sessions.user_id TEXT NOT NULL REFERENCES users(id)`; `002_users_uuid.sql` later turned
`users.id` into a `UUID`. So **001 cannot apply to any database that has advanced past 002**, is
never recorded, and is retried and re-failed on every boot — the local ledger holds **165 rows
starting at 002**.

A multi-statement `pool.query` is one implicit transaction, so the whole file rolls back. Measured
against `pg_indexes` locally, **5 of its 9 indexes are absent**; four are on live tables
(`idx_el_name_date`, `idx_programs_user`, `idx_style_user`, `idx_bm_user_date`).

Two things I am **not** claiming. The three indexes declared *only* in 001 that nonetheless exist
(`idx_el_ws`, `idx_sl_el`, `idx_ps_program_pos`) mean this database's history is not a clean single
pass, so the missing list does not automatically transfer. And **production cannot be checked from a
session** — `claude_ro` exposes curated views, not `pg_indexes`. That is worth resolving: a missing
`body_metrics(user_id, date DESC)` in production would be a plausible contributor to **Q-107**'s
`/api/sync/pull` slowness, which is still waiting on evidence.

`cardio_sessions` itself is dead: the table does not exist and `grep` finds zero references outside
the migrations directory.

## Verification

- `tsc --noEmit` clean · `eslint` clean · full suite **416 files / 3279 tests** green.
- New unit test pins the classifier against the six benign codes, the real `42804`, five other
  genuine codes, and the codeless cases.
- Booted `pnpm dev` against the local database and read the actual output — both blocks above are
  copied from real runs, before and after.

**Not exercised:** production. The classification is pure log formatting so there is nothing
user-facing to break, but the only database this ran against is the local dev one.
