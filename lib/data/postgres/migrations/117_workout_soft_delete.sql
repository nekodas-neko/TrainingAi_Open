-- Extends the 111 soft-delete pattern to the workout tables it excluded, so
-- getSyncDelta can emit tombstones and cross-device workout deletes propagate
-- instead of resurrecting on devices that haven't synced.
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE exercise_logs    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE set_logs         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
