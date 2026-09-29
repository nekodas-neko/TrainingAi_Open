-- LB-179. How a prescribed run was satisfied: 'run', or 'walk' once RV-166 lets a walk complete one.
-- The planner reads `status = 'completed'` in three places (the hard-run gate, the week's 80/20
-- sequence, and run-type pace stats). Without this, a walk marked completed reads as a run in all
-- three. NULL means completed before this was tracked, and every such row was a run: the link only
-- ever fired for activity type 'run'. Deliberately NOT backfilled, because NULL already implies it.
ALTER TABLE prescribed_runs ADD COLUMN IF NOT EXISTS completed_as text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prescribed_runs_completed_as_check') THEN
    ALTER TABLE prescribed_runs ADD CONSTRAINT prescribed_runs_completed_as_check
      CHECK (completed_as IS NULL OR completed_as IN ('run', 'walk'));
  END IF;
END $$;
