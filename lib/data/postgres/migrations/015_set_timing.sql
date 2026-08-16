ALTER TABLE set_logs      ADD COLUMN IF NOT EXISTS set_start_ms BIGINT;
ALTER TABLE set_logs      ADD COLUMN IF NOT EXISTS set_end_ms   BIGINT;
ALTER TABLE exercise_logs ADD COLUMN IF NOT EXISTS inter_exercise_rest_sec INTEGER;
