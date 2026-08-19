# 2026-08-19 — Q-324: the local migration runner recorded nothing, so every process re-ran ~200 migrations

**Branch:** `fix/local-migrate-bookkeeping` · Implementation Lane A.

## What is measured, and what is not

`scripts/local-db/migrate.js` applied every migration file and wrote **nothing** to
`schema_migrations`. `ensureSchema()` — which every DB test and the dev server call — reads that
table to decide what to skip, so a database the runner had just fully migrated looked **empty** to
it, and the next process re-applied all ~200 files. Under `vitest` that is every worker doing it
concurrently against one Postgres.

Measured on a freshly-migrated database before the change:

- `SELECT to_regclass('public.schema_migrations')` returned **NULL** — the table did not exist at
  all, so this is not "the bookkeeping was incomplete", it is "there was none".
- **Three migrations failed during ordinary local setup** as a direct consequence: the `claude_ro`
  view generators rebuild a schema that includes `schema_migrations`, and it was not there.
- **CI runs this exact script** (`.github/workflows/ci.yml`, *"Apply all migrations"*, immediately
  before `pnpm test`), so CI has been in this state on every run since the script existed.

**What did NOT reproduce, and I am not claiming a fix for it.** Q-324 was filed this morning off a
`Tests` failure on #195 whose signature was a timeout in `complete-workout-increment-race`
(`Hook timed out in 10000ms` in `beforeAll`) and `admin/backfill-derived-scores`. Running the full
suite today against a genuinely fresh, unrecorded database — the exact CI condition — came back
**516 files / 4,232 tests green, no timeouts**. So the symptom is load-dependent contention, not a
deterministic consequence, and this change removes a large source of that load without proving it
removes the symptom. Anyone seeing those timeouts again should treat them as still open.

## What changed

The runner now creates `schema_migrations`, skips files already recorded, and records each file it
applies — the same shape `ensureSchema()` uses, so the two agree on what "applied" means.

**A file is recorded only when it applied cleanly.** A migration that genuinely failed stays
unrecorded so `ensureSchema()` retries it, exactly as in production. Recording a failure here would
silently skip it forever, which is worse than the problem being fixed.

Measured after the change, on a fresh database:

| | before | after |
|---|---|---|
| `schema_migrations` after `migrate.js` | **does not exist** | 203 rows |
| migrations failing during local setup | 3 | **1** |
| what the next `ensureSchema()` applies | all ~203 | 1 |
| first full-suite run against a fresh DB | 200.19 s | **183.18 s** |

The one remaining failure is `142_claude_ro_views.sql` referencing `db_query_log`, which a later
migration creates — a genuine ordering artefact that predates this and self-heals when a later
`claude_ro` migration rebuilds the schema. It is correctly left unrecorded and retried.

## The guard, and what it does not cover

`scripts/local-db/__tests__/migrate-records-applied.test.ts` asserts on the runner's **source**: that
it creates the table, records applied files, skips recorded ones, and that the INSERT sits inside the
`try` rather than after the `catch`. Proving the *behaviour* needs a scratch database and ~200
migrations, which is a slow fixture this suite does not have — so this catches the regression that
actually happened and would not catch a subtler one, such as recording a file that failed. That
second case is guarded by the comment in the runner explaining why the placement matters.

## Not exercised

Production. `ensureSchema()` is unchanged; only the local/CI setup script moved. Nothing here touches
the device, native code, or any user-facing surface.
