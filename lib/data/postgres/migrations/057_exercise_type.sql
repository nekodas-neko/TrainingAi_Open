-- Distinguish bodyweight exercises (situps, pull-ups, dips) from weighted ones.
-- For bodyweight exercises, the logged "weight" is an optional added/assisted load —
-- the user's bodyweight is substituted as the base load for 1RM/PR calculations.
ALTER TABLE exercise_library ADD COLUMN IF NOT EXISTS exercise_type TEXT NOT NULL DEFAULT 'weighted';

DO $$ BEGIN
  ALTER TABLE exercise_library
    ADD CONSTRAINT exercise_library_exercise_type_check
    CHECK (exercise_type IN ('weighted', 'bodyweight'));
EXCEPTION WHEN others THEN NULL;
END $$;

-- Backfill: exercises whose only equipment is bodyweight are pure bodyweight movements
UPDATE exercise_library
SET exercise_type = 'bodyweight'
WHERE equipment = ARRAY['bodyweight']::text[];
