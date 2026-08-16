# 2026-08-09 — `001_initial.sql` stops re-failing, and the production answer retracts my own hypothesis (Q-159)

**Branch:** `fix/001-initial-never-applied` · **Domain:** `platform` · **Migration 174** · no version
bump (schema/boot, nothing user-visible)

## What was wrong

`001_initial.sql:145` declares `cardio_sessions.user_id TEXT NOT NULL REFERENCES users(id)`, and
`002_users_uuid.sql` later made `users.id` a `UUID`. Re-applying 001 to any database past 002 raises
**42804**. `ensureSchema` records a migration only after a *successful* apply, so 001 was never
recorded and was retried — and re-failed — on every single boot. Q-152 made that line loud; this
makes it stop.

A multi-statement `pool.query` runs as one implicit transaction, so each failed retry rolled the
whole file back, leaving its indexes uncreated on any database whose 001 never completed.

## The production answer, which I could not get myself

`claude_ro` exposes curated views, not `pg_indexes`, so Q-159 was filed with production explicitly
marked unknown. The owner ran the query:

| index | production | local dev |
|---|---|---|
| `idx_bm_user_date` | **present** | missing |
| `idx_programs_user` | **present** | missing |
| `idx_style_user` | **present** | missing |
| `idx_el_name_date` | absent | absent |

Two corrections fall out of that.

**1. Production was never missing anything.** The three gaps are a drifted local dev database. The
entry's "4 indexes missing on live tables" was a local measurement generalised too far — which the
entry did flag as unverified, and the flag was right.

**2. `idx_el_name_date` is absent by design, in both.** `009_perf_indexes.sql` **drops** it and
replaces it with `idx_el_name_date_ws`, a superset covering index carrying `workout_session_id`.
Confirmed `idx_el_name_date_ws` exists locally and 009 is in the ledger. Counting it as missing was
my error — I read 001's declaration and never checked whether a later migration retired it.

## 🚫 Retracting the Q-107 link

Q-159 suggested a missing `body_metrics(user_id, date DESC)` in production could contribute to
**Q-107**'s `/api/sync/pull` slowness. **That index exists in production, so it cannot.** The
suggestion is withdrawn from the backlog and `projectOverview.md`. Q-107 still has no evidence and
still must not be built on a guess.

Worth stating plainly: that hypothesis was the most interesting-sounding thing in the entry, and it
was wrong. One query from the owner settled in seconds what no amount of local measurement could.

## What shipped

`lib/data/postgres/migrations/174_retire_001_initial_retry.sql`:

- `CREATE INDEX IF NOT EXISTS` for the three indexes — a no-op in production, a repair anywhere
  drifted. Because production already holds all three, the non-`CONCURRENT` create takes no
  meaningful lock there.
- `INSERT INTO schema_migrations ('001_initial.sql') ON CONFLICT DO NOTHING` — ends the retry loop.
  Idempotent on a fresh database, where 001 applies cleanly and records itself long before 174 runs.

**Deliberately not created:** `cardio_sessions` and `idx_cs_user_date`. The table exists in no
environment, `grep` finds zero references outside `migrations/`, and creating it would mean
inventing the `user_id` type 001 got wrong. And `idx_el_name_date`, which 009 removed on purpose.

## Verification

- Applied migration 174 **twice** against the local database — second run clean, so it is idempotent.
- Booted `pnpm dev`: `[ensureSchema] 5 applied, 4 already present, 0 failed`, with 001 gone from the
  block. Before this it was `0 applied, 4 already present, 1 failed`.
- `tsc --noEmit` clean · full suite **422 files / 3341 tests** green · all custom-rule scripts pass ·
  `check-migration-numbers` reports no collisions, next free 175.

**Not exercised:** production. The migration is a no-op there by measurement, but it has not run
there — `ensureSchema` will apply it on the next cold start after deploy. The one observable change
should be that `001_initial.sql` stops appearing in the boot block.
