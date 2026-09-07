-- BF-129: 22 catalogue rows carry `equipment = '{}'`, and both equipment filters read an empty
-- list as an unconditional pass -- `ex.equipment.length === 0 || ex.equipment.some(...)` in
-- app/api/generate-program/route.ts and components/workout-builder/builder-review.tsx. So an
-- unlabelled row clears EVERY equipment selection anyone can make. Three of the 22 are machines,
-- which is how an owner who trains at home with a barbell, dumbbells, a cable tower and a pull-up
-- bar was offered Machine Chest Press.
--
-- The worst-case default is defensible for a genuine unknown. What is not defensible is 22 knowns
-- being unknown, so this fills them in rather than changing what empty means. (The filter is
-- hardened in the same PR, and a test asserts this table stays fully labelled -- the data is the
-- fix, the other two are what stop it drifting back.)
--
-- Values are anchored to a labelled SIBLING row wherever one exists, not invented:
--   Cable Crunch Abs   <- `Cable Crunch` merged INTO it (migration 165) and was ['cable']
--   Weighted Dip       <- `Dip` is ['bodyweight','machine']
--   Wrist Extension    <- `Barbell/Dumbbell Wrist Curl`; unqualified name takes the dumbbell one
--   Pallof Press       <- every other anti-rotation/carry-over cable movement is ['cable']
-- The nine `exercise_type = 'bodyweight'` rows take ['bodyweight'], which is what 13 of the 14
-- already-labelled bodyweight-typed rows carry.
--
-- `Abs` is the one judgement call: a generic name typed `weighted` with no sibling to anchor to.
-- It takes ['bodyweight'] because its crunch siblings are all bodyweight, and because a wrong
-- minute in the time model is cheaper than an exercise the lifter cannot perform.
--
-- Idempotent: each UPDATE is guarded on the row still being unlabelled.
UPDATE exercise_library el
SET equipment = v.equipment
FROM (VALUES
  ('Abs',                    ARRAY['bodyweight']),
  ('Barbell Box Squat',      ARRAY['barbell']),
  ('Burpee',                 ARRAY['bodyweight']),
  ('Cable Crunch Abs',       ARRAY['cable']),
  ('Decline Dumbbell Press', ARRAY['dumbbell']),
  ('Diamond Push-Up',        ARRAY['bodyweight']),
  ('Donkey Kick',            ARRAY['bodyweight']),
  ('Fire Hydrant',           ARRAY['bodyweight']),
  ('Inverted Row',           ARRAY['bodyweight']),
  ('Machine Chest Press',    ARRAY['machine']),
  ('Machine Shoulder Press', ARRAY['machine']),
  ('Machine Shrug',          ARRAY['machine']),
  ('Mountain Climbers',      ARRAY['bodyweight']),
  ('Pallof Press',           ARRAY['cable']),
  ('Pike Push-Up',           ARRAY['bodyweight']),
  ('Rack Pull',              ARRAY['barbell']),
  ('Side Plank',             ARRAY['bodyweight']),
  ('Toe Touch Crunch',       ARRAY['bodyweight']),
  ('V-Up',                   ARRAY['bodyweight']),
  ('Weighted Dip',           ARRAY['bodyweight', 'machine']),
  ('Wrist Extension',        ARRAY['dumbbell'])
) AS v(name, equipment)
WHERE el.name = v.name
  AND coalesce(array_length(el.equipment, 1), 0) = 0;

-- `Dumbbell Lunges` is a duplicate of `Dumbbell Lunge` (['dumbbell']), so it wants a merge rather
-- than an equipment value -- the same additive shape migration 165 used: the row keeps its id and
-- every FK stays valid, and `listExerciseLibrary` stops offering it. History is deliberately NOT
-- rewritten, for the reason 165 gives: this is a GLOBAL catalogue, and another account's rows are
-- not this migration's to move.
UPDATE exercise_library child
SET merged_into = canonical.id
FROM exercise_library canonical
WHERE child.name = 'Dumbbell Lunges'
  AND canonical.name = 'Dumbbell Lunge'
  AND child.id <> canonical.id
  AND child.merged_into IS NULL;
