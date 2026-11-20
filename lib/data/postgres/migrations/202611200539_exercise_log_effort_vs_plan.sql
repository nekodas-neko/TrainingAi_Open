-- #3892 (step 2 of #3889, before #3745's build): the lifter's answer to "how did this exercise
-- feel?", asked once per exercise after its last set, stored as the answer itself.
--
-- The owner's pick (20 Nov, on #3745) is "Easier than expected / As expected / Harder than
-- expected" against the plan. The session read (#3889) uses the answer directly to decide the next
-- weight, so it is kept as a three-way value rather than converted into an effort number:
--
--   effort_vs_plan  -1 easier than expected, 0 as expected, +1 harder than expected.
--                   NULL: the question was not shown (logged before it existed, or never finished).
--   effort_source   'tapped'  the lifter chose the answer
--                   'default' the answer was left on the question's starting value, "as expected"
--                   NULL when no answer is stored.
--
-- `set_logs.rpe` and `rpe_source` stay as they are for sets rated by hand.
--
-- Additive only: two nullable columns, no default, no backfill, so the column adds are
-- catalog-only. Adding each CHECK scans exercise_logs once to validate it; every existing row is
-- NULL there, so it passes. Nothing reads or writes the columns until #3745 is built; this ships
-- in a release of its own first.
--
-- Guards: `lock_timeout` so a long reader on exercise_logs makes this give up (and ensureSchema retry
-- it on the next boot) rather than queue workout uploads behind it; `statement_timeout` as a
-- backstop. Both are SET LOCAL, scoped to this migration's transaction.
--
-- REVERSE (loses only answers recorded since). The claude_ro view lists columns explicitly, so it
-- has to go first or the column drop is refused (#3246); the next boot rebuilds it from
-- claude-ro-views.sql. Dropping a column drops its CHECK with it:
--   DROP VIEW IF EXISTS claude_ro.exercise_logs;
--   ALTER TABLE exercise_logs DROP COLUMN effort_source, DROP COLUMN effort_vs_plan;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE exercise_logs ADD COLUMN IF NOT EXISTS effort_vs_plan smallint;
ALTER TABLE exercise_logs ADD COLUMN IF NOT EXISTS effort_source text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exercise_logs_effort_vs_plan_check') THEN
    ALTER TABLE exercise_logs ADD CONSTRAINT exercise_logs_effort_vs_plan_check
      CHECK (effort_vs_plan IN (-1, 0, 1));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exercise_logs_effort_source_check') THEN
    ALTER TABLE exercise_logs ADD CONSTRAINT exercise_logs_effort_source_check
      CHECK (effort_source IN ('tapped', 'default'));
  END IF;
END $$;

