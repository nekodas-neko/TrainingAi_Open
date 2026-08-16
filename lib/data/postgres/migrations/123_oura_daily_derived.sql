-- Completed-form derived metrics, one row per user per local day (Oura on-device-models
-- program, Sub-plan A / master §4.1). This is the *scored/analysis* layer that sits on top
-- of the measured physiology in oura_daily_summary / sleep_sessions / body_metrics: the
-- finished outputs of every derived model (readiness, sleep/activity scores + contributors,
-- illness radar, stress, training load, energy, body composition, vascular age).
--
-- Motivation is analysis-first + optional read-path acceleration: the rollup snapshots the
-- finished values here so we have a durable analysis history AND so heavy live-recomputes
-- (readiness composite, OTS, the sleep feature stack) can be read instead of recomputed on
-- every paint. It is NOT authoritative over the measured tables — those keep the raw values;
-- this holds derived/scored outputs only. Persisting here is also what lets the bulky raw be
-- culled later (derive -> store compact -> drop raw).
--
-- Created ONCE, up front, with every column the program's sub-plans will write (all nullable),
-- so later feature PRs only write to existing columns and never race on ADD COLUMN ordering.
-- A metric absent for a day is simply NULL (never fabricated). Server-side only (written by the
-- rollup, read by the readiness route) — not a device-synced table, so no local-SQLite mirror.
CREATE TABLE IF NOT EXISTS oura_daily_derived (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     DATE NOT NULL, -- local day, same convention as oura_daily.date

  -- Provenance (master §4.6): which pipeline produced these + per-model version tags.
  source         TEXT,  -- 'ble-derived' | 'oura-cloud'
  model_versions JSONB, -- e.g. {"readiness":"1.0","sleepScore":"1.0","ots":"0.2.1"}

  -- Sleep (Sub-plan C)
  sleep_score         INTEGER,
  sleep_contributors  JSONB,

  -- Readiness (Sub-plan E)
  readiness_score        INTEGER,
  readiness_contributors JSONB,
  readiness_source       TEXT,

  -- Activity / movement / energy / load (Sub-plan D)
  activity_score        INTEGER,
  activity_contributors JSONB,
  active_calories_est   INTEGER,  -- derived estimate; distinct from body_metrics.active_calories
  training_load_ots     DOUBLE PRECISION,
  training_load_high    BOOLEAN,

  -- Recovery / baselines (Sub-plan E)
  recovery_index_hours  DOUBLE PRECISION,
  worn_hours_ble        DOUBLE PRECISION,
  night_hrv_baseline_ms DOUBLE PRECISION,

  -- Illness radar (Sub-plan E) — baseline-first; surfaces in the readiness indicator
  illness_flag       TEXT,     -- 'learning' | 'normal' | 'watch' | 'elevated' | 'fever'
  illness_score      INTEGER,  -- 0-100
  illness_biomarkers JSONB,    -- per-biomarker { z, contribution }

  -- Stress / resilience (Sub-plan E)
  daytime_stress_scaled       DOUBLE PRECISION, -- [-1, 1]
  stress_high_minutes         INTEGER,
  recovery_high_minutes       INTEGER,
  chronic_stress_score        INTEGER,
  chronic_stress_contributors JSONB,
  resilience_level            DOUBLE PRECISION, -- 1.0-5.0

  -- Cardiovascular / body composition (Sub-plan F)
  vascular_age DOUBLE PRECISION,
  pwv          DOUBLE PRECISION,
  body_comp    JSONB, -- { fatMassKg, ffmKg, bmrKcal }

  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);

CREATE INDEX IF NOT EXISTS oura_daily_derived_user_day_idx ON oura_daily_derived(user_id, day DESC);
