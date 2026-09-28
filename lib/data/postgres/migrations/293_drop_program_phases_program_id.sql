-- LA-159 — drop program_phases.program_id, the column phases stopped using when they moved under
-- phase_set_id (021/024). Measured on production 2026-09-28: 46 of the owner's rows, 0 non-null,
-- and no reader or writer in app/, lib/, packages/ or scripts/. It was worth removing rather than
-- ignoring because a join on it answers "none" with no error, which is how LA-138 first reported
-- 46 phases as 0.
--
-- ⚠ GUARDED, because that measurement can only see the owner's rows (claude_ro is owner-scoped)
-- and this drop reaches every account. It drops only when NO row anywhere holds a value, so it
-- cannot destroy data it was not shown; otherwise it leaves the column and says so.
--
-- The claude_ro view SELECTs the column, so it must go first (LA-142 found that the hard way);
-- claude-ro-views.sql, regenerated in the same PR, recreates it without the column when it is
-- applied after the migrations in this deploy.
--
-- Replay-safe: on a schema where the column is already gone this is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'program_phases' AND column_name = 'program_id'
  ) THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM program_phases WHERE program_id IS NOT NULL) THEN
    RAISE NOTICE 'LA-159: program_phases.program_id still holds values somewhere; not dropped';
    RETURN;
  END IF;
  DROP VIEW IF EXISTS claude_ro.program_phases;
  ALTER TABLE program_phases DROP COLUMN program_id;
END $$;
