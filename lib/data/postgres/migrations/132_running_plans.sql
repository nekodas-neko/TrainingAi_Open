-- Running Prescription Engine (design: docs/superpowers/plans/2026-07-17-running-prescription-engine.md).
-- running_plans: one active plan per user (goal + framework + fitness snapshot).
-- prescribed_runs: each generated run; status flips to completed/skipped as a user write,
-- and links the actual activity_logs row on completion. Soft-deletable + synced.
CREATE TABLE IF NOT EXISTS running_plans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_kind          text NOT NULL DEFAULT 'cardio_health',
  target_distance_km double precision,
  target_date        date,
  framework_key      text NOT NULL DEFAULT 'polarized-80-20',
  fitness_snapshot   jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS running_plans_one_active_per_user
  ON running_plans (user_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS prescribed_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id         uuid NOT NULL REFERENCES running_plans(id) ON DELETE CASCADE,
  date            date NOT NULL,
  run_type        text NOT NULL,
  duration_min    double precision,
  distance_km     double precision,
  target_hr_low   integer,
  target_hr_high  integer,
  target_zone_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  rationale       text NOT NULL DEFAULT '',
  gate_action     text NOT NULL DEFAULT 'proceed',
  status          text NOT NULL DEFAULT 'pending',   -- 'pending' | 'completed' | 'skipped'
  activity_log_id uuid REFERENCES activity_logs(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS prescribed_runs_user_plan_date
  ON prescribed_runs (user_id, plan_id, date);
CREATE INDEX IF NOT EXISTS prescribed_runs_user_date ON prescribed_runs (user_id, date);
