-- LA-24 (Kind 2) — the shrug and glute-bridge families follow their corrected barbell sibling.
--
-- **Owner-decided 2026-08-25.** This is the half migration 219 deliberately left out: BF-16a's
-- additions to `Barbell Shrug` and `Barbell Hip Thrust` came from anatomy with no in-catalogue
-- precedent, so extending them to the rest of each family is the same judgement made five more
-- times. 219's comment says making it unasked is how a catalogue drifts by assertion, so it was put
-- to the owner instead. The answer was yes — with "for now" attached, which is why the reversal note
-- at the bottom of this file is not boilerplate.
--
-- Verified against PRODUCTION immediately before writing this, after 216 and 219 had applied:
--
--   Barbell Shrug        traps(m), upper back(s), forearms(s)   <- the corrected sibling
--   Dumbbell Shrug       traps(m)                               <- + upper back, forearms
--   Machine Shrug        traps(m)                               <- + upper back, forearms
--
--   Barbell Hip Thrust   glutes(m), hamstrings(s), quads(s), lower back(s), adductors(s)
--   Barbell Glute Bridge     glutes(m), hamstrings(s)           <- + quads, lower back, adductors
--   Bodyweight Glute Bridge  glutes(m), hamstrings(s)           <- ditto
--   Single Leg Hip Thrusts   glutes(m), hamstrings(s)           <- ditto
--
-- WHAT WOULD MAKE THIS WRONG, recorded because the decision was "for now" rather than settled: the
-- entry's own doubt is that loading differs within a family — a machine shrug's handles may be
-- supported where a barbell shrug's grip is not, and a bodyweight glute bridge does not load the
-- quads the way a loaded hip thrust does. If that turns out to matter, the correction is another
-- append/remove migration on these same seven rows; nothing downstream stores a copy. `muscles` is
-- read in a live subquery by the volume tallies, so a change re-derives history rather than applying
-- only forward, and the device re-hydrates its mirror from `/api/workout-data` — no APK needed.
--
-- Idempotent by construction, same shape as 216 and 219: each statement appends one assignment and
-- skips when the row already names that muscle, compared case-insensitively because the catalogue
-- carries a few Title Case values. Array order is not load-bearing — every consumer filters on
-- `role`.

DO $$
DECLARE
  fix RECORD;
BEGIN
  FOR fix IN
    SELECT * FROM (VALUES
      ('Dumbbell Shrug',          'upper back'),
      ('Dumbbell Shrug',          'forearms'),
      ('Machine Shrug',           'upper back'),
      ('Machine Shrug',           'forearms'),
      ('Barbell Glute Bridge',    'quads'),
      ('Barbell Glute Bridge',    'lower back'),
      ('Barbell Glute Bridge',    'adductors'),
      ('Bodyweight Glute Bridge', 'quads'),
      ('Bodyweight Glute Bridge', 'lower back'),
      ('Bodyweight Glute Bridge', 'adductors'),
      ('Single Leg Hip Thrusts',  'quads'),
      ('Single Leg Hip Thrusts',  'lower back'),
      ('Single Leg Hip Thrusts',  'adductors')
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
