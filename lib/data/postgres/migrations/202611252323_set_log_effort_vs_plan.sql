-- #4154 (columns only; the screen and the upload are #4155): the lifter's answer to "how did that
-- set feel against the plan?", stored per set so weight, reps and effort can be read together.
-- Same meaning and values as exercise_logs.effort_vs_plan / effort_source (#3892).
--
--   effort_vs_plan  -1 easier than expected, 0 as expected, +1 harder than expected.
--                   NULL: the question was not shown for this set.
--   effort_source   'tapped'  the lifter chose the answer
--                   'default' the answer was left on "as expected"
--                   NULL when no answer is stored.
--
-- The two are stored together or not at all (set_logs_effort_pair_check). `rpe` and `rpe_source`
-- are untouched.
--
-- Additive only: two nullable columns, no default, no backfill, so the column adds are
-- catalog-only. Every existing set stays NULL; adding each CHECK scans set_logs once, and every
-- existing row passes. Nothing reads or writes the columns in this release.
--
-- Guards: `lock_timeout` so a long reader on set_logs makes this give up (and ensureSchema retry
-- it on the next boot) rather than queue workout uploads behind it; `statement_timeout` as a
-- backstop. Both are SET LOCAL, scoped to this migration's transaction.
--
-- REVERSE (loses only answers recorded since). The claude_ro view lists columns explicitly, so it
-- has to go first or the column drop is refused (#3246); the next boot rebuilds it from
-- claude-ro-views.sql. Dropping a column drops its CHECKs with it:
--   DROP VIEW IF EXISTS claude_ro.set_logs;
--   ALTER TABLE set_logs DROP COLUMN effort_source, DROP COLUMN effort_vs_plan;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE set_logs ADD COLUMN IF NOT EXISTS effort_vs_plan smallint;
ALTER TABLE set_logs ADD COLUMN IF NOT EXISTS effort_source text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'set_logs_effort_vs_plan_check') THEN
    ALTER TABLE set_logs ADD CONSTRAINT set_logs_effort_vs_plan_check
      CHECK (effort_vs_plan IN (-1, 0, 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'set_logs_effort_source_check') THEN
    ALTER TABLE set_logs ADD CONSTRAINT set_logs_effort_source_check
      CHECK (effort_source IN ('tapped', 'default'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'set_logs_effort_pair_check') THEN
    ALTER TABLE set_logs ADD CONSTRAINT set_logs_effort_pair_check
      CHECK ((effort_vs_plan IS NULL) = (effort_source IS NULL));
  END IF;
END $$;
