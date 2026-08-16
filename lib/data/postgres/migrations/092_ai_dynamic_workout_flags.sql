ALTER TABLE workout_sessions
  ADD COLUMN IF NOT EXISTS was_override   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS intensity_mode TEXT
    CHECK (intensity_mode IN ('full', 'deload'));
