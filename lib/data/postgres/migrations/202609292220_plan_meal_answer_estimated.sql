-- BF-203a (meal-plan tracking, phase A). `plan_meal_answers` was declines-only (Q-187 phase 2). It
-- gains ONE new state, `estimated`: a planned meal's window passed with nothing logged and nothing
-- declined, so the plan's macros are assumed for the day. `'yes'` is still deliberately NOT a state:
-- "I ate it" stays derivable from the food log, and an estimate never writes a food log.
--
-- Additive and reversible: six nullable columns and a widened CHECK. Existing rows are all 'no' and
-- satisfy both constraints as they stand, so nothing is rewritten.

ALTER TABLE plan_meal_answers
  ADD COLUMN IF NOT EXISTS est_calories   integer,
  ADD COLUMN IF NOT EXISTS est_protein_g  double precision,
  ADD COLUMN IF NOT EXISTS est_carbs_g    double precision,
  ADD COLUMN IF NOT EXISTS est_fat_g      double precision,
  -- The bias applied when this estimate was written, and which rule produced it, so a stored estimate
  -- can be explained months later rather than re-derived against a model that has since changed.
  ADD COLUMN IF NOT EXISTS est_bias_kcal  integer,
  ADD COLUMN IF NOT EXISTS est_basis      text;

-- Migration 187 pinned `answer IN ('no')` on purpose, noting that allowing another value was "one
-- migration away". This is that migration.
ALTER TABLE plan_meal_answers DROP CONSTRAINT IF EXISTS plan_meal_answers_answer_check;
ALTER TABLE plan_meal_answers
  ADD CONSTRAINT plan_meal_answers_answer_check CHECK (answer IN ('no', 'estimated'));

-- An estimate must carry its calories, and a decline must carry none, so a macro-less estimate or a
-- decline that silently adds calories cannot be written.
ALTER TABLE plan_meal_answers DROP CONSTRAINT IF EXISTS plan_meal_answers_estimate_shape;
ALTER TABLE plan_meal_answers
  ADD CONSTRAINT plan_meal_answers_estimate_shape CHECK (
    (answer = 'estimated' AND est_calories IS NOT NULL)
    OR (answer <> 'estimated' AND est_calories IS NULL)
  );
