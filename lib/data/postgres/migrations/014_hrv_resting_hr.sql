ALTER TABLE body_metrics
  ADD COLUMN IF NOT EXISTS resting_heart_rate INTEGER,
  ADD COLUMN IF NOT EXISTS hrv_ms             DOUBLE PRECISION;
