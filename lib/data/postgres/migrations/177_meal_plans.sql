-- Meal Plan, Phase 1 (Q-186). Plan doc: docs/superpowers/plans/2026-08-11-meal-plan.md
--
-- Three tables, not two. `meal_plan_variants` sits between the plan and its meals so a plan can
-- carry different macros on training days and rest days (decision D7). The owner asked whether
-- variants should be a V2; they are here from the start because retrofitting a day type later
-- costs a migration plus a rework of the setup flow, while modelling it now costs one table and a
-- setup step that only appears if the toggle is on. A plan with no training/rest split simply has
-- one variant with day_type = 'all', which is also the default.
--
-- Per-meal macros are STORED rather than derived at render, so editing one meal does not silently
-- reflow the others. The plan-level totals-vs-target delta is computed on read and surfaced; drift
-- is shown to the user, never auto-corrected.

CREATE TABLE IF NOT EXISTS meal_plans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  is_active             BOOLEAN NOT NULL DEFAULT false,
  meals_per_day         INTEGER NOT NULL,
  -- Snapshot of the calorie/macro target at generation time. The live target lives in
  -- nutrition_targets and moves as the calibration learns; the plan records what it was built
  -- against so the 4-week review can say "your maintenance moved, this plan is stale".
  target_calories       INTEGER NOT NULL,
  target_protein_g      DOUBLE PRECISION NOT NULL,
  target_carbs_g        DOUBLE PRECISION NOT NULL,
  target_fat_g          DOUBLE PRECISION NOT NULL,
  -- 'HH:MM' in the user's local time; NULL when they have no usual training time.
  training_time         TEXT,
  stores                JSONB NOT NULL DEFAULT '[]'::jsonb,
  excluded_foods        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The user's dietary restrictions as they stood when this plan was generated (D8). The live set
  -- lives in user_dietary_restrictions; this snapshot is why an old plan still explains itself
  -- after the user edits their restrictions.
  restrictions_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Optional free-text hint, deliberately secondary to the structured picker. A fixed taxonomy
  -- always misses something ("onions give me migraines"), and the alternative to a text box is the
  -- user silently getting a plan they cannot eat.
  avoid_note            TEXT,
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Drives the ~4-week check-in. There is no cron layer in this app, so the review is an on-open
  -- card that compares this against now() — never a scheduled job.
  last_reviewed_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ
);

-- One active plan per user, enforced by the database rather than by application code. Doing this
-- in app code means two concurrent activations can both win; a partial unique index cannot.
CREATE UNIQUE INDEX IF NOT EXISTS meal_plans_one_active_per_user
  ON meal_plans (user_id)
  WHERE is_active AND deleted_at IS NULL;

-- Reads are "this user's live plans, newest first".
CREATE INDEX IF NOT EXISTS meal_plans_user_live_idx
  ON meal_plans (user_id, generated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS meal_plan_variants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plan_id     UUID NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
  -- 'all' when the plan applies the same macros every day; otherwise 'training' and 'rest' as a
  -- pair. Which one applies to a given date is resolved from the user's existing schedule — this
  -- schema deliberately does not introduce a second definition of "training day".
  day_type         TEXT NOT NULL CHECK (day_type IN ('all', 'training', 'rest')),
  target_calories  INTEGER NOT NULL,
  target_protein_g DOUBLE PRECISION NOT NULL,
  target_carbs_g   DOUBLE PRECISION NOT NULL,
  target_fat_g     DOUBLE PRECISION NOT NULL,
  UNIQUE (meal_plan_id, day_type)
);

CREATE INDEX IF NOT EXISTS meal_plan_variants_plan_idx
  ON meal_plan_variants (meal_plan_id);

CREATE TABLE IF NOT EXISTS meal_plan_meals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id       UUID NOT NULL REFERENCES meal_plan_variants(id) ON DELETE CASCADE,
  -- Both nullable and both ON DELETE SET NULL: deleting a meal type or a saved meal must not take
  -- the plan row with it. The denormalised name/macros below are what keep the row renderable.
  meal_type_id     UUID REFERENCES meal_types(id) ON DELETE SET NULL,
  saved_meal_id    UUID REFERENCES saved_meals(id) ON DELETE SET NULL,
  position         INTEGER NOT NULL,
  name             TEXT NOT NULL,
  notes            TEXT,
  target_calories  INTEGER NOT NULL,
  target_protein_g DOUBLE PRECISION NOT NULL,
  target_carbs_g   DOUBLE PRECISION NOT NULL,
  target_fat_g     DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS meal_plan_meals_variant_idx
  ON meal_plan_meals (variant_id, position);
