-- #2634: a daily resting heart rate from still daytime periods, with how many minutes backed it.
--
-- The shadow readiness model's Heart pillar has a unit "daytime resting HR, still periods" that
-- nothing stores. No existing column can hold it: `oura_daily_summary.rhr_*` and
-- `body_metrics.resting_heart_rate` are the night/primary RHR, and reusing them would change what
-- those mean. These two sit beside the other completed-form daily metrics on `oura_daily_derived`.
--
--   still_rhr_bpm          median HR of the day's still minutes (MET under the active threshold).
--   still_rhr_coverage_min how many still minutes with a heart rate that median rests on.
--
-- NULL means "not computed (or too thin to trust)", never zero. Every existing row is NULL until the
-- rollup that fills them ships in a later release.
--
-- Shipped alone (CLAUDE.md: a migration never rides in a batch with anything else); the code that
-- writes and reads the columns follows in its own PR, so no code reads a column that is not there.
--
-- Additive only: two nullable columns with no default (catalog-only, no rewrite). No existing row is
-- changed, backfilled or deleted.
--
-- Guards: `lock_timeout` so a long reader on oura_daily_derived makes this give up (and ensureSchema
-- retry it on the next boot) rather than queue the rollup's writes behind it; `statement_timeout` as
-- a backstop. Both are SET LOCAL, scoped to this migration's transaction.
--
-- REVERSE (loses only the still-period values recorded since). The claude_ro view lists columns
-- explicitly, so it has to go first or the column drop is refused (#3263); the next boot rebuilds it:
--   DROP VIEW IF EXISTS claude_ro.oura_daily_derived;
--   ALTER TABLE oura_daily_derived DROP COLUMN still_rhr_bpm, DROP COLUMN still_rhr_coverage_min;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE oura_daily_derived ADD COLUMN IF NOT EXISTS still_rhr_bpm DOUBLE PRECISION;
ALTER TABLE oura_daily_derived ADD COLUMN IF NOT EXISTS still_rhr_coverage_min INTEGER;
