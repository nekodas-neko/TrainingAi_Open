-- 030_exercise_equipment.sql
-- Normalizes equipment values to lowercase/singular (migration 021 used capitalized/plural).
-- Resets all equipment to empty, then repopulates with consistent lowercase values.

ALTER TABLE exercise_library ADD COLUMN IF NOT EXISTS equipment TEXT[] DEFAULT '{}';

-- Reset all to empty so we start with consistent lowercase values
UPDATE exercise_library SET equipment = '{}';

-- Chest
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Bench Press';
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Incline Bench Press';
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Decline Bench Press';
UPDATE exercise_library SET equipment = ARRAY['dumbbell']                             WHERE name = 'Chest Fly';
UPDATE exercise_library SET equipment = ARRAY['cable']                                WHERE name = 'Cable Fly';
UPDATE exercise_library SET equipment = ARRAY['machine']                              WHERE name = 'Pec Deck';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']                           WHERE name = 'Push-Up';
UPDATE exercise_library SET equipment = ARRAY['bodyweight', 'machine']                WHERE name = 'Dip';

-- Shoulders
UPDATE exercise_library SET equipment = ARRAY['barbell', 'dumbbell']                  WHERE name = 'Overhead Press';
UPDATE exercise_library SET equipment = ARRAY['dumbbell']                             WHERE name = 'Arnold Press';
UPDATE exercise_library SET equipment = ARRAY['dumbbell', 'cable', 'kettlebell']      WHERE name = 'Lateral Raise';
UPDATE exercise_library SET equipment = ARRAY['dumbbell', 'barbell', 'kettlebell']    WHERE name = 'Front Raise';
UPDATE exercise_library SET equipment = ARRAY['cable']                                WHERE name = 'Face Pull';
UPDATE exercise_library SET equipment = ARRAY['dumbbell', 'cable']                    WHERE name = 'Reverse Fly';
UPDATE exercise_library SET equipment = ARRAY['barbell', 'dumbbell', 'cable']         WHERE name = 'Upright Row';

-- Traps
UPDATE exercise_library SET equipment = ARRAY['barbell', 'dumbbell']                  WHERE name = 'Shrug';

-- Triceps
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Close Grip Bench';
UPDATE exercise_library SET equipment = ARRAY['cable', 'machine']                     WHERE name = 'Tricep Pushdown';
UPDATE exercise_library SET equipment = ARRAY['barbell', 'dumbbell']                  WHERE name = 'Skull Crusher';
UPDATE exercise_library SET equipment = ARRAY['dumbbell', 'cable']                    WHERE name = 'Overhead Tricep Ext';

-- Biceps
UPDATE exercise_library SET equipment = ARRAY['dumbbell', 'kettlebell']               WHERE name = 'Dumbbell Curl';
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Barbell Curl';
UPDATE exercise_library SET equipment = ARRAY['dumbbell', 'kettlebell']               WHERE name = 'Hammer Curl';
UPDATE exercise_library SET equipment = ARRAY['barbell', 'dumbbell', 'machine']       WHERE name = 'Preacher Curl';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']                           WHERE name = 'Chin-Up';

-- Forearms
UPDATE exercise_library SET equipment = ARRAY['barbell', 'dumbbell']                  WHERE name = 'Wrist Curl';

-- Back
UPDATE exercise_library SET equipment = ARRAY['bodyweight']                           WHERE name = 'Pull-Up';
UPDATE exercise_library SET equipment = ARRAY['cable', 'machine']                     WHERE name = 'Lat Pulldown';
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Barbell Row';
UPDATE exercise_library SET equipment = ARRAY['dumbbell', 'kettlebell']               WHERE name = 'Dumbbell Row';
UPDATE exercise_library SET equipment = ARRAY['cable']                                WHERE name = 'Cable Row';
UPDATE exercise_library SET equipment = ARRAY['cable', 'machine']                     WHERE name = 'Seated Row';
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'T-Bar Row';

-- Lower Body
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Deadlift';
UPDATE exercise_library SET equipment = ARRAY['barbell', 'dumbbell']                  WHERE name = 'Romanian Deadlift';
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Good Morning';
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Squat';
UPDATE exercise_library SET equipment = ARRAY['barbell']                              WHERE name = 'Front Squat';
UPDATE exercise_library SET equipment = ARRAY['machine']                              WHERE name = 'Hack Squat';
UPDATE exercise_library SET equipment = ARRAY['machine']                              WHERE name = 'Leg Press';
UPDATE exercise_library SET equipment = ARRAY['barbell', 'dumbbell', 'kettlebell']    WHERE name = 'Bulgarian Split Squat';
UPDATE exercise_library SET equipment = ARRAY['machine']                              WHERE name = 'Leg Extension';
UPDATE exercise_library SET equipment = ARRAY['machine']                              WHERE name = 'Leg Curl';
UPDATE exercise_library SET equipment = ARRAY['barbell', 'machine']                   WHERE name = 'Hip Thrust';
UPDATE exercise_library SET equipment = ARRAY['barbell', 'dumbbell', 'bodyweight', 'kettlebell'] WHERE name = 'Glute Bridge';
UPDATE exercise_library SET equipment = ARRAY['machine', 'barbell', 'dumbbell', 'kettlebell']    WHERE name = 'Calf Raise';
UPDATE exercise_library SET equipment = ARRAY['machine']                              WHERE name = 'Adductor Machine';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']                           WHERE name = 'Hip Flexor Raise';

-- Core
UPDATE exercise_library SET equipment = ARRAY['bodyweight']                           WHERE name = 'Plank';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']                           WHERE name = 'Ab Wheel';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']                           WHERE name = 'Crunch';
UPDATE exercise_library SET equipment = ARRAY['bodyweight']                           WHERE name = 'Leg Raise';
