-- Daily Oura Ring aggregated scores (readiness, sleep, activity) and contributors.
-- One row per user per day. Populated by /api/oura/sync.
CREATE TABLE IF NOT EXISTS oura_daily (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date    DATE NOT NULL,

  -- Readiness (GET /v2/usercollection/daily_readiness)
  readiness_score              INTEGER,           -- 0-100
  temperature_deviation        DOUBLE PRECISION,  -- °C deviation from baseline
  temperature_trend_deviation  DOUBLE PRECISION,  -- °C multi-day trend
  readiness_contributors       JSONB,
  -- { activity_balance, body_temperature, hrv_balance, previous_day_activity,
  --   previous_night, recovery_index, resting_heart_rate, sleep_balance } — each 0-100

  -- Sleep score (GET /v2/usercollection/daily_sleep)
  sleep_score         INTEGER,  -- 0-100
  sleep_contributors  JSONB,
  -- { deep_sleep, efficiency, latency, rem_sleep, restfulness, timing, total_sleep } — each 0-100

  -- Activity score (GET /v2/usercollection/daily_activity)
  activity_score              INTEGER,  -- 0-100
  active_calories             INTEGER,  -- calories burned from activity
  total_calories              INTEGER,  -- total daily calories burned (TDEE)
  equivalent_walking_distance INTEGER,  -- metres
  high_activity_time_sec      INTEGER,
  medium_activity_time_sec    INTEGER,
  low_activity_time_sec       INTEGER,
  sedentary_time_sec          INTEGER,
  non_wear_time_sec           INTEGER,
  activity_contributors       JSONB,
  -- { meet_daily_targets, move_every_hour, recovery_time, stay_active,
  --   training_frequency, training_volume } — each 0-100

  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_oura_daily_user_date ON oura_daily (user_id, date DESC);
