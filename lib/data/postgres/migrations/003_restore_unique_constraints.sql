-- Migration 003: Restore UNIQUE constraints dropped by migration 002.
--
-- Migration 002 dropped the old user_id TEXT column and renamed user_uuid → user_id,
-- but PostgreSQL silently drops any constraint that referenced the old column.
-- This restores the three UNIQUE constraints lost in that rename.
--
-- IDEMPOTENT: each ADD CONSTRAINT is guarded with a NOT EXISTS check.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'programs_user_id_name_key' AND conrelid = 'programs'::regclass
  ) THEN
    ALTER TABLE programs ADD CONSTRAINT programs_user_id_name_key UNIQUE (user_id, name);
    RAISE NOTICE 'Migration 003: added programs(user_id, name) unique constraint';
  ELSE
    RAISE NOTICE 'Migration 003: programs(user_id, name) unique constraint already exists, skipping';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'progression_styles_user_id_name_key' AND conrelid = 'progression_styles'::regclass
  ) THEN
    ALTER TABLE progression_styles ADD CONSTRAINT progression_styles_user_id_name_key UNIQUE (user_id, name);
    RAISE NOTICE 'Migration 003: added progression_styles(user_id, name) unique constraint';
  ELSE
    RAISE NOTICE 'Migration 003: progression_styles(user_id, name) unique constraint already exists, skipping';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'body_metrics_user_id_date_key' AND conrelid = 'body_metrics'::regclass
  ) THEN
    ALTER TABLE body_metrics ADD CONSTRAINT body_metrics_user_id_date_key UNIQUE (user_id, date);
    RAISE NOTICE 'Migration 003: added body_metrics(user_id, date) unique constraint';
  ELSE
    RAISE NOTICE 'Migration 003: body_metrics(user_id, date) unique constraint already exists, skipping';
  END IF;
END $$;
