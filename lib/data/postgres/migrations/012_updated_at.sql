DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workout_sessions' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE workout_sessions
      ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercise_logs' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE exercise_logs
      ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'set_logs' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE set_logs
      ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END $$;
