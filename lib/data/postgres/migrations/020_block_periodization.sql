CREATE TABLE IF NOT EXISTS program_phases (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id          UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  position            INTEGER NOT NULL,
  name                TEXT NOT NULL,
  duration_cycles     INTEGER NOT NULL CHECK (duration_cycles >= 1),
  phase_type          TEXT NOT NULL DEFAULT 'normal' CHECK (phase_type IN ('normal', 'peak', 'deload', 'accessory')),
  primary_style_id    UUID REFERENCES progression_styles(id) ON DELETE SET NULL,
  secondary_style_id  UUID REFERENCES progression_styles(id) ON DELETE SET NULL,
  UNIQUE (program_id, position)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'programs' AND column_name = 'phase_mode') THEN
    ALTER TABLE programs ADD COLUMN phase_mode TEXT NOT NULL DEFAULT 'manual';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'programs' AND column_name = 'started_at') THEN
    ALTER TABLE programs ADD COLUMN started_at DATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'programs' AND column_name = 'sessions_per_cycle') THEN
    ALTER TABLE programs ADD COLUMN sessions_per_cycle INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'programs' AND column_name = 'early_deload_week_start') THEN
    ALTER TABLE programs ADD COLUMN early_deload_week_start DATE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'session_exercises' AND column_name = 'exercise_role') THEN
    ALTER TABLE session_exercises ADD COLUMN exercise_role TEXT NOT NULL DEFAULT 'primary';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workout_sessions' AND column_name = 'phase_id') THEN
    ALTER TABLE workout_sessions ADD COLUMN phase_id UUID REFERENCES program_phases(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workout_sessions' AND column_name = 'is_early_deload') THEN
    ALTER TABLE workout_sessions ADD COLUMN is_early_deload BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;
