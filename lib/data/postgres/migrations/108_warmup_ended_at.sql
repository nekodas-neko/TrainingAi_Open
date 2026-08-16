-- When the user tapped "Begin exercises" on the warmup screen. Splits actual
-- warmup time from first-exercise setup in session time decomposition.
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS warmup_ended_at TIMESTAMPTZ;
