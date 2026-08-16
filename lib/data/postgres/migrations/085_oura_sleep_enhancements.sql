-- Add Oura Ring-specific columns to sleep_sessions.
-- oura_id enables idempotent re-sync (UNIQUE prevents duplicates).
ALTER TABLE sleep_sessions
  ADD COLUMN IF NOT EXISTS oura_id            TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS efficiency         INTEGER,          -- 0-100 %
  ADD COLUMN IF NOT EXISTS onset_latency_sec  INTEGER,          -- seconds to fall asleep
  ADD COLUMN IF NOT EXISTS average_hrv_ms     DOUBLE PRECISION, -- rMSSD during sleep
  ADD COLUMN IF NOT EXISTS avg_heart_rate     INTEGER,          -- bpm during sleep
  ADD COLUMN IF NOT EXISTS lowest_heart_rate  INTEGER,          -- bpm (proxy for resting HR)
  ADD COLUMN IF NOT EXISTS restless_periods   INTEGER,
  ADD COLUMN IF NOT EXISTS sleep_score        INTEGER;          -- from daily_sleep endpoint
