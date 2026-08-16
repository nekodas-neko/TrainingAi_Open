-- AI Nutrition & Activity Goal Recommender — adds the profile fields that drive the
-- deterministic baseline calculation (lib/nutrition/goal-recommendation.ts) and the
-- goal_recommendations history table that records every AI suggestion (applied or
-- dismissed) for the Profile "Activity & Goals" review flow.

ALTER TABLE users ADD COLUMN IF NOT EXISTS activity_level TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fitness_goal TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_goal_review_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS goal_recommendations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source                      TEXT NOT NULL,
  recommended_steps_goal      INTEGER,
  recommended_calories        INTEGER,
  recommended_protein_g       DOUBLE PRECISION,
  recommended_carbs_g         DOUBLE PRECISION,
  recommended_fat_g           DOUBLE PRECISION,
  recommended_water_ml        INTEGER,
  recommended_activity_level  TEXT,
  reasoning                   TEXT,
  insights                    TEXT,
  data_quality_note           TEXT,
  status                      TEXT NOT NULL DEFAULT 'pending',
  applied_at                  TIMESTAMPTZ,
  dismissed_at                TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_goal_recommendations_user ON goal_recommendations(user_id, created_at DESC);
