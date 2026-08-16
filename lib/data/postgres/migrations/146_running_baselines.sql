CREATE TABLE IF NOT EXISTS running_baselines (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id                UUID NOT NULL REFERENCES running_plans(id) ON DELETE CASCADE,
  vo2max                 DOUBLE PRECISION,
  max_hr                 INTEGER,
  resting_hr             INTEGER,
  threshold_hr           INTEGER,
  weekly_base_minutes    DOUBLE PRECISION,
  easy_pace_sec_per_km   DOUBLE PRECISION,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS running_baselines_one_per_plan ON running_baselines(plan_id);
