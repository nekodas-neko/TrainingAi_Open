-- LA-24 (Kind 1) — five more catalogue rows record fewer muscles than a member of their own family.
--
-- BF-16a (migration 216) corrected the five rows the owner's report named. Scanning the whole live
-- catalogue for the same shape found eight more, in two kinds. This migration ships only the kind
-- that needs no judgement: **another member of the same movement family already records the muscle
-- being added**, so this propagates the catalogue's own answer rather than originating one.
--
-- The other three families (Dumbbell Shrug, Machine Shrug, and the glute-bridge rows) are NOT here.
-- BF-16a's additions to their siblings had no in-catalogue precedent either, so extending them means
-- making the same anatomical call five more times unasked, which is how a catalogue drifts by
-- assertion. Those stay owner-gated in LA-24.
--
-- Each addition and the row that establishes it — all verified against PRODUCTION on 2026-08-25,
-- after 216 had applied there:
--
--   Dumbbell Overhead Press + traps       Barbell Overhead Press: shoulders(m), triceps(s), traps(s)
--   Machine Shoulder Press  + traps       ditto
--   Arnold Press            + traps       ditto
--   Lat Pulldown            + upper back  Close Grip Lat Pulldown and Chin-Up carry it as secondary;
--                                         Pull-Up carries it as a main
--   Decline Bench Press     + shoulders   Decline Dumbbell Press, Incline Bench Press and Machine
--                                         Chest Press all carry shoulders on the same pattern
--
-- All five sit at 2 muscles, so BF-15's anchor rule (a catalogued exercise with >= 3) bars them
-- exactly as it barred BF-16a's rows.
--
-- Idempotent by construction, same shape as 216: each statement appends one assignment and skips
-- when the row already names that muscle, compared case-insensitively because the catalogue carries
-- a few Title Case values. Array order is not load-bearing — every consumer filters on `role`.

DO $$
DECLARE
  fix RECORD;
BEGIN
  FOR fix IN
    SELECT * FROM (VALUES
      ('Dumbbell Overhead Press', 'traps'),
      ('Machine Shoulder Press',  'traps'),
      ('Arnold Press',            'traps'),
      ('Lat Pulldown',            'upper back'),
      ('Decline Bench Press',     'shoulders')
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
