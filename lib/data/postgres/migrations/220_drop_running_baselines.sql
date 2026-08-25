-- Q-301b: drop the physical `running_baselines` table. Q-301 removed the code half on 2026-08-24
-- (`saveRunningBaseline`/`getRunningBaseline`, the `RunningBaseline` interface, the dead write in
-- `app/api/running-plan/route.ts`, and the Drizzle `schema.ts` entry), leaving the table as a
-- disconnected leftover no query can name. The owner authorised the drop the same day.
--
-- This is a data-dropping migration. It is safe here for a reason that must NOT be generalised:
-- the table has NEVER been written by anyone. `pg_stat_user_tables.n_tup_ins` is a lifetime insert
-- counter maintained on every write — not a planner estimate like `n_live_tup`, and not row-scoped
-- to one user like a `claude_ro` count(*) — and it read 0 (with n_tup_upd/n_tup_del also 0, 16 kB
-- total) both when the owner authorised this and again immediately before this migration was
-- written. The emptiness is also explained rather than assumed: the writer landed in migration 146
-- after the only `running_plans` row was created (2026-07-21), and no plan has been created since.
--
-- What the feature uses instead: `resolveSnapshot()` in
-- `packages/shared/src/running/assemble-plan-context.ts` recomputes from `fitness_tests` and
-- `body_metrics` fresh on every request, so the 12 `prescribed_runs` derive from live data, not
-- from the plan-creation-time snapshot this table would have held.

-- The claude_ro view depends on the table, so it goes first. Dropped BY NAME rather than with
-- CASCADE: cascade would silently take whatever else happened to depend on the table, and the
-- point of a migration like this is that its blast radius is written down. Migration 221
-- regenerates the whole claude_ro schema (it drops and rebuilds every run), so nothing is left
-- missing — but this file must run first, and filename sort order is what guarantees that.
DROP VIEW IF EXISTS claude_ro.running_baselines;

DROP TABLE IF EXISTS running_baselines;
