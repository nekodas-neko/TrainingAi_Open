-- BF-16a — five catalogue rows record fewer muscles than the movement they mirror.
--
-- This is the data defect behind the owner's report that *"hip thrusts and dumbbell shoulder press
-- should be able to be a secondary"*: the role rule reads muscle counts, and BF-15's anchor rule
-- requires a catalogued exercise with >= 3 muscles, so a row seeded short can never be classified
-- above accessory no matter what the thresholds say.
--
-- NOT production drift. The short lists were seeded that way by 008 and 032 and are identical in
-- every database — verified 2026-08-25 by fingerprinting all 140 seeded rows in the local dev DB
-- against production: the `muscles` column matches on every one. So a corrective UPDATE is what
-- fixes both, and a fresh install too, since this runs after the seeds that wrote the short lists.
--
-- Each addition and the sibling movement that establishes it (the full comparison is in the PR):
--
--   Cable Chest Dips        + shoulders    Dip, Weighted Dip, Barbell Bench Press, Machine Chest
--                                          Press all carry shoulders on the same pressing pattern
--   Dumbbell Shoulder Press + traps        Barbell Overhead Press carries traps
--   Cable Pulldown          + upper back   Close Grip Lat Pulldown and Chin-Up carry upper back;
--                                          Pull-Up carries it as a main
--   Barbell Hip Thrust      + quads,       no in-catalogue precedent — the hip-thrust/bridge family
--                             lower back,  is uniformly 2 muscles. Anatomical, per BF-16a.
--                             adductors
--   Barbell Shrug           + upper back,  forearms follows Farmer's Walk, the other grip-loaded
--                             forearms     traps movement. `rhomboids` is written as `upper back`
--                                          because normalizeMuscle() folds it there.
--
-- Idempotent by construction: each statement appends one assignment and skips when the row already
-- names that muscle, compared case-insensitively (the catalogue carries a few Title Case values).
-- Re-running is a no-op, and a row somebody has since edited by hand keeps the edit rather than
-- being reset to a snapshot taken today. Array order is not load-bearing — every consumer filters
-- on `role` (`lib/coach/tools.ts`, `lib/local-store/program-assembler.ts`, the raw-SQL tallies)
-- and none indexes the array — so appending is safe.

DO $$
DECLARE
  fix RECORD;
BEGIN
  FOR fix IN
    SELECT * FROM (VALUES
      ('Cable Chest Dips',        'shoulders'),
      ('Dumbbell Shoulder Press', 'traps'),
      ('Cable Pulldown',          'upper back'),
      ('Barbell Hip Thrust',      'quads'),
      ('Barbell Hip Thrust',      'lower back'),
      ('Barbell Hip Thrust',      'adductors'),
      ('Barbell Shrug',           'upper back'),
      ('Barbell Shrug',           'forearms')
    ) AS t(exercise_name, muscle)
  LOOP
    UPDATE exercise_library
    SET muscles = muscles || jsonb_build_array(
                    jsonb_build_object('muscle', fix.muscle, 'role', 'secondary'))
    WHERE name = fix.exercise_name
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(muscles) m
        WHERE lower(m->>'muscle') = fix.muscle
      );
  END LOOP;
END $$;
