-- Migration 004: Add optional icon column to program_sessions.
-- Stores a user-selected emoji override; NULL means fall back to palette position.
-- IDEMPOTENT: skips if the column already exists.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'program_sessions' AND column_name = 'icon'
  ) THEN
    ALTER TABLE program_sessions ADD COLUMN icon TEXT;
    RAISE NOTICE 'Migration 004: added program_sessions.icon column';
  ELSE
    RAISE NOTICE 'Migration 004: program_sessions.icon already exists, skipping';
  END IF;
END $$;
