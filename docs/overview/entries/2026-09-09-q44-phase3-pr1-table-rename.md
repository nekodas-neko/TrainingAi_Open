# 2026-09-09 — the vendor table rename, and what compatibility views cannot cover (Q-44 Phase 3, PR 1)

**Branch:** `lane-a/q44-phase3-pr1-table-rename` · **Lane A** · migrations 273 + 274.
**Owner asked to see this before it merges** — a rename of 11 production tables auto-deploys.

## What it does

Eleven vendor-named tables get vendor-neutral names, each with a `SELECT *` compatibility view left
behind at the old name. `oura_daily → sensor_daily`, `oura_ble_clock_anchors → ring_clock_anchors`,
`oura_daytime_hrv_model → daytime_hrv_model`, and so on. `oura_tokens` and `oura_raw_samples` keep
theirs, for the reasons in the plan and repeated in the migration header.

Code still names the old tables. That is PR 1's design: the views carry it until PR 2 moves the code.

## The assumption I proved instead of assuming

The whole safety story rests on an auto-updatable view carrying writes. I nearly discarded the plan
over a half-remembered limitation — that `INSERT … ON CONFLICT` does not work on views. **It does.**
Proven against this schema before the migration was written: plain INSERT, UPDATE, DELETE,
composite-column `ON CONFLICT DO UPDATE` (three of the four conflict sites use a composite target),
and `ON CONFLICT … DO UPDATE … WHERE` (which correctly no-opped). Had the limitation been real, the
compatibility story would have collapsed and the whole three-PR sequence would need rethinking.

Worth recording both ways round: the check cost two minutes, and reaching for memory would have
either killed a sound plan or shipped a broken one.

## What the plan did not anticipate, and it is the finding

**"Code keeps using the old names" holds for DML only.** A view carries reads and writes. It has no
primary key, no indexes, and no row in `pg_stat_user_tables`. Three sites depended on exactly those:

| site | symptom |
|---|---|
| `full-export.ts` | discovers the PK to paginate safely → **threw, taking the entire user-data export down**, not one table |
| `getOuraStorageStats` | reads `pg_stat_user_tables` (tables only) → footprint silently reported **6 tables instead of 14** |
| `hr-keyset-index-dropped.test.ts` | reads `pg_indexes` by table name → empty set, which reads as *"the index was dropped"* |

Plus a fourth: a `CREATE INDEX` statement carried in a source comment as the restore-driver recipe.
DDL cannot target a view, so a restore pointed at the compatibility name would have failed at the
moment it was needed.

All four now name physical tables, with comments saying why they must stay that way. **This is the
rule the next two PRs need:** anything that addresses the catalogue — DDL, `pg_*`,
`information_schema`, PK discovery — must move in the PR that renames, not the one that moves code.

The full-export case is the one to remember. It is not a degraded read; it is a hard failure of a
user-facing feature, and it would have shipped green if the export tests were not DB-backed.

## Deliberately untouched

`lib/sqlite/migrations.ts` carries the same table names for the **device-local** database. That is a
separate schema, renaming there would strand every installed device, and it belongs to a SQLite
version bump. A later sweep must not "finish the job" there.

## Verification

- 61 catalogue statements applied to the local DB; **row counts identical** across all 11 tables read
  through their views.
- Full CRUD proven through the views against the real tables, not a synthetic pair.
- `claude_ro` regenerated into 274 (never editing an applied migration — `ensureSchema` tracks by
  filename). Its view-name diff against 272 is **exactly 11 out, 11 in**; 98 views before and after.
- Full suite green.

**Not exercised:** production. The rename is proven against the local schema and the compatibility
behaviour is proven by construction, but no overlapping-container deploy has been observed — that is
the scenario the views exist for and it only happens on Railway.
