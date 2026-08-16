-- Per-night daily summary + personal baselines (Oura BLE Phase 5 addendum A3). The
-- substrate that turns the readiness composite's baseline-relative contributors
-- (HRV Balance, Resting-HR, Temperature, Sleep Balance) from crude to real: a
-- rolling personal baseline per metric, accrued nightly, trailing/causal-only (never
-- looks ahead). Baselines are cold for the first ~14 nights — the readiness route
-- flags those contributors as provisional rather than fabricating precision.
--
-- Baseline state (mean/deviation, ×8 fixed-point, age in nights) is the ecore-style
-- asymmetric EMA from lib/health/personal-baseline.ts, one row of state per metric
-- per user carried forward night to night — stored inline here (not a separate
-- table) since a night's summary IS the baseline checkpoint after that night's update.
CREATE TABLE IF NOT EXISTS oura_daily_summary (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       DATE NOT NULL, -- wake day, same convention as oura_daily.date

  -- This night's raw inputs (nulls when the ring had no signal for that night)
  sleep_duration_hours  DOUBLE PRECISION,
  sleep_efficiency       DOUBLE PRECISION,
  deep_sleep_hours       DOUBLE PRECISION,
  rem_sleep_hours        DOUBLE PRECISION,
  restless_periods       INTEGER,
  sleep_latency_sec      INTEGER,
  hrv_avg_ms             DOUBLE PRECISION,
  rhr_low_bpm            DOUBLE PRECISION,
  rhr_avg_bpm            DOUBLE PRECISION,
  recovery_index_hours   DOUBLE PRECISION,
  temp_mean_c            DOUBLE PRECISION,  -- nightly_temperature() output, this night
  temp_dev_c             DOUBLE PRECISION,  -- deviation from the baseline BEFORE this night's update
  met_avg                DOUBLE PRECISION,  -- daily activity intensity proxy (avg MET-minutes)

  -- Trailing personal baselines (mean, ×8 fixed-point state carried forward) + this
  -- night's normalized deviation z-score — null until the metric has a first sample.
  hrv_baseline_mean_x8   INTEGER,
  hrv_baseline_dev_x8    INTEGER,
  rhr_baseline_mean_x8   INTEGER,
  rhr_baseline_dev_x8    INTEGER,
  temp_baseline_mean_x8  INTEGER,
  temp_baseline_dev_x8   INTEGER,
  sleep_baseline_mean_x8 INTEGER,
  sleep_baseline_dev_x8  INTEGER,
  met_baseline_mean_x8   INTEGER,
  met_baseline_dev_x8    INTEGER,
  -- Nights of history accrued so far (shared age counter across all 5 metrics —
  -- one per-user nightly cadence, not per-metric independent ages).
  n_history              INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS oura_daily_summary_user_date_idx ON oura_daily_summary(user_id, date DESC);
