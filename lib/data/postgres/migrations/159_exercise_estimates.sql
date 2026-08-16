-- Q-5: separate the two meanings that `personal_records` has been serving.
--
-- An earned all-time best and a starting 1RM the user typed into the program builder are
-- different facts, and conflating them is why the builder's own copy ("Enter your 1RM for
-- each main lift to pre-seed working weights") has never been true: the seeded value went
-- into `personal_records`, which the workout screen's weight path does not read.
--
-- `personal_records` becomes log-derived only. This table holds the user-entered estimate.
-- Additive: nothing is dropped or rewritten here. Correcting the drifted `personal_records`
-- rows is a separate, owner-confirmed migration.
--
-- Plan: docs/superpowers/plans/2026-07-28-personal-records-log-derived-and-starting-weights.md

CREATE TABLE IF NOT EXISTS exercise_estimates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Carried from the start so the eventual name -> id identity move has somewhere to land;
  -- the unique key stays on the name because that is how the builder identifies an exercise.
  exercise_id   UUID REFERENCES exercise_library(id) ON DELETE SET NULL,
  exercise_name TEXT NOT NULL,
  estimated_1rm DOUBLE PRECISION NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, exercise_name)
);

CREATE INDEX IF NOT EXISTS idx_exercise_estimates_user ON exercise_estimates (user_id);
