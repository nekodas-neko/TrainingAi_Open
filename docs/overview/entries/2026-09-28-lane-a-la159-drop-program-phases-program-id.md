# 2026-09-28 — LA-159: `program_phases.program_id` dropped, behind a guard that cannot lose data

The column phases stopped using when they moved under `phase_set_id` (021/024). A join on it answers
"none" with no error, which is how LA-138 first reported 46 phases as 0.

**Evidence it is dead:** 0 of the owner's 46 rows hold a value in production. No reader or writer
exists in `app/`, `lib/`, `packages/` or `scripts/`: every insert path sets only `phase_set_id`, and
only the claude_ro predicate and the export map read it, both removed here. **That production
measurement is owner-scoped**, so migration 293 checks again at run time and drops the column only
if no row in any account holds a value. Otherwise it leaves the column and raises a notice.

- **Migration 293:** a guarded, replay-safe `DO` block that drops the claude_ro view first (the
  shape LA-142 found was necessary), then the column. `claude-ro-views.sql` is regenerated without
  the column or the predicate arm, and `export-map.ts` loses the arm too.
- **Replay:** CI's Migration Check re-runs every migration against a full schema. 021's backfill
  reads the column, so it joins 001 in `REPLAY_EXEMPT`, which makes one exemption. LA-114's lesson
  was that a column named in a dozen migrations cannot be removed this way; this one is named in
  one. Reproduced CI's procedure locally (fresh database, migrations only, truncate, `--replay`):
  clean.
- **Tests:** the guard is tested inside rolled-back transactions (a value keeps the column, all-null
  drops it, and it is a no-op once gone). Mutations: removing the value guard and removing the
  existence check were both killed. `claude-ro-program-phases-scope` loses its two cases that pinned
  the column as always-NULL.

**Held for the owner's yes before merge**, as the entry required for a data-dropping migration,
even though the guard means nothing with a value can be dropped.
