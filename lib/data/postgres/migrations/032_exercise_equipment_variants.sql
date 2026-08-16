-- 032_exercise_equipment_variants.sql
-- Splits generic multi-equipment exercise names into equipment-specific variants.
-- Updates all string references across session_exercises, exercise_logs,
-- personal_records. Clears exercise_gif_cache for affected names so GIFs
-- are re-fetched with the better, specific names.

-- ─── SECTION 1: Insert new variant exercises ──────────────────────────────────
-- Only insert if not already present (idempotent).

INSERT INTO exercise_library (name, muscles, equipment) VALUES
  -- Overhead Press split
  ('Barbell Overhead Press',        '[{"muscle":"Shoulders","role":"main"},{"muscle":"Triceps","role":"secondary"},{"muscle":"Traps","role":"secondary"}]', ARRAY['barbell']),
  ('Dumbbell Overhead Press',       '[{"muscle":"Shoulders","role":"main"},{"muscle":"Triceps","role":"secondary"}]',                                        ARRAY['dumbbell']),
  -- Lateral Raise split
  ('Dumbbell Lateral Raise',        '[{"muscle":"Shoulders","role":"main"}]',                                                                               ARRAY['dumbbell','kettlebell']),
  ('Cable Lateral Raise',           '[{"muscle":"Shoulders","role":"main"}]',                                                                               ARRAY['cable']),
  -- Front Raise split
  ('Dumbbell Front Raise',          '[{"muscle":"Shoulders","role":"main"}]',                                                                               ARRAY['dumbbell','kettlebell']),
  ('Cable Front Raise',             '[{"muscle":"Shoulders","role":"main"}]',                                                                               ARRAY['cable']),
  -- Reverse Fly split
  ('Dumbbell Reverse Fly',          '[{"muscle":"Shoulders","role":"main"},{"muscle":"Upper Back","role":"secondary"}]',                                    ARRAY['dumbbell']),
  ('Cable Reverse Fly',             '[{"muscle":"Shoulders","role":"main"},{"muscle":"Upper Back","role":"secondary"}]',                                    ARRAY['cable']),
  -- Upright Row split
  ('Barbell Upright Row',           '[{"muscle":"Traps","role":"main"},{"muscle":"Shoulders","role":"secondary"}]',                                         ARRAY['barbell']),
  ('Cable Upright Row',             '[{"muscle":"Traps","role":"main"},{"muscle":"Shoulders","role":"secondary"}]',                                         ARRAY['cable']),
  -- Shrug split
  ('Barbell Shrug',                 '[{"muscle":"Traps","role":"main"}]',                                                                                   ARRAY['barbell']),
  ('Dumbbell Shrug',                '[{"muscle":"Traps","role":"main"}]',                                                                                   ARRAY['dumbbell']),
  -- Skull Crusher split
  ('Barbell Skull Crusher',         '[{"muscle":"Triceps","role":"main"}]',                                                                                 ARRAY['barbell']),
  ('Dumbbell Skull Crusher',        '[{"muscle":"Triceps","role":"main"}]',                                                                                 ARRAY['dumbbell']),
  -- Overhead Tricep Extension split
  ('Cable Overhead Tricep Extension',    '[{"muscle":"Triceps","role":"main"}]',                                                                            ARRAY['cable']),
  ('Dumbbell Overhead Tricep Extension', '[{"muscle":"Triceps","role":"main"}]',                                                                            ARRAY['dumbbell']),
  -- Wrist Curl split
  ('Barbell Wrist Curl',            '[{"muscle":"Forearms","role":"main"}]',                                                                                ARRAY['barbell']),
  ('Dumbbell Wrist Curl',           '[{"muscle":"Forearms","role":"main"}]',                                                                                ARRAY['dumbbell']),
  -- Romanian Deadlift split
  ('Barbell Romanian Deadlift',     '[{"muscle":"Hamstrings","role":"main"},{"muscle":"Glutes","role":"main"},{"muscle":"Lower Back","role":"secondary"}]', ARRAY['barbell']),
  ('Dumbbell Romanian Deadlift',    '[{"muscle":"Hamstrings","role":"main"},{"muscle":"Glutes","role":"main"}]',                                            ARRAY['dumbbell']),
  -- Bulgarian Split Squat split
  ('Barbell Bulgarian Split Squat', '[{"muscle":"Quads","role":"main"},{"muscle":"Glutes","role":"secondary"},{"muscle":"Hamstrings","role":"secondary"}]', ARRAY['barbell']),
  ('Dumbbell Bulgarian Split Squat','[{"muscle":"Quads","role":"main"},{"muscle":"Glutes","role":"secondary"},{"muscle":"Hamstrings","role":"secondary"}]', ARRAY['dumbbell','kettlebell']),
  -- Glute Bridge split
  ('Barbell Glute Bridge',          '[{"muscle":"Glutes","role":"main"},{"muscle":"Hamstrings","role":"secondary"}]',                                       ARRAY['barbell']),
  ('Bodyweight Glute Bridge',       '[{"muscle":"Glutes","role":"main"},{"muscle":"Hamstrings","role":"secondary"}]',                                       ARRAY['bodyweight']),
  -- Calf Raise split
  ('Machine Calf Raise',            '[{"muscle":"Calves","role":"main"}]',                                                                                  ARRAY['machine']),
  ('Barbell Calf Raise',            '[{"muscle":"Calves","role":"main"}]',                                                                                  ARRAY['barbell']),
  ('Dumbbell Calf Raise',           '[{"muscle":"Calves","role":"main"}]',                                                                                  ARRAY['dumbbell']),
  -- Simple renames (new canonical name)
  ('Barbell Squat',                 '[{"muscle":"Quads","role":"main"},{"muscle":"Glutes","role":"secondary"},{"muscle":"Hamstrings","role":"secondary"},{"muscle":"Core","role":"secondary"}]', ARRAY['barbell']),
  ('Barbell Deadlift',              '[{"muscle":"Hamstrings","role":"main"},{"muscle":"Glutes","role":"main"},{"muscle":"Lower Back","role":"main"},{"muscle":"Traps","role":"secondary"}]',      ARRAY['barbell']),
  ('Barbell Front Squat',           '[{"muscle":"Quads","role":"main"},{"muscle":"Glutes","role":"secondary"},{"muscle":"Core","role":"secondary"}]',        ARRAY['barbell']),
  ('Barbell Good Morning',          '[{"muscle":"Hamstrings","role":"main"},{"muscle":"Lower Back","role":"main"},{"muscle":"Glutes","role":"secondary"}]',  ARRAY['barbell']),
  ('Dumbbell Hammer Curl',          '[{"muscle":"Biceps","role":"main"},{"muscle":"Forearms","role":"secondary"}]',                                         ARRAY['dumbbell','kettlebell']),
  -- Barbell Preacher Curl (Dumbbell variant already in DB from migration 008)
  ('Barbell Preacher Curl',         '[{"muscle":"Biceps","role":"main"}]',                                                                                  ARRAY['barbell']),
  -- Bent-Over Barbell Row canonical name
  ('Bent-Over Barbell Row',         '[{"muscle":"Upper Back","role":"main"},{"muscle":"Lats","role":"main"},{"muscle":"Biceps","role":"secondary"}]',        ARRAY['barbell'])
ON CONFLICT (name) DO NOTHING;

-- ─── SECTION 2: Update session_exercises references ───────────────────────────

-- Simple renames
UPDATE session_exercises SET exercise_name = 'Barbell Squat'              WHERE exercise_name = 'Squat';
UPDATE session_exercises SET exercise_name = 'Barbell Deadlift'           WHERE exercise_name = 'Deadlift';
UPDATE session_exercises SET exercise_name = 'Barbell Front Squat'        WHERE exercise_name IN ('Front Squat', 'Front Barbell Squat');
UPDATE session_exercises SET exercise_name = 'Barbell Good Morning'       WHERE exercise_name = 'Good Morning';
UPDATE session_exercises SET exercise_name = 'Barbell Hip Thrust'         WHERE exercise_name IN ('Hip Thrust', 'Hip Thrusts');
UPDATE session_exercises SET exercise_name = 'Dumbbell Hammer Curl'       WHERE exercise_name = 'Hammer Curl';
UPDATE session_exercises SET exercise_name = 'Barbell Bench Press'        WHERE exercise_name = 'Bench Press';
UPDATE session_exercises SET exercise_name = 'Bent-Over Barbell Row'      WHERE exercise_name IN ('Barbell Row', 'Bent Over Barbell Row');
UPDATE session_exercises SET exercise_name = 'Machine Calf Raise'         WHERE exercise_name IN ('Calf Raise', 'Calf Raises');
-- Splits → default to primary variant
UPDATE session_exercises SET exercise_name = 'Barbell Overhead Press'     WHERE exercise_name = 'Overhead Press';
UPDATE session_exercises SET exercise_name = 'Dumbbell Lateral Raise'     WHERE exercise_name IN ('Lateral Raise', 'DB Lateral Raises');
UPDATE session_exercises SET exercise_name = 'Dumbbell Front Raise'       WHERE exercise_name = 'Front Raise';
UPDATE session_exercises SET exercise_name = 'Dumbbell Reverse Fly'       WHERE exercise_name = 'Reverse Fly';
UPDATE session_exercises SET exercise_name = 'Barbell Upright Row'        WHERE exercise_name = 'Upright Row';
UPDATE session_exercises SET exercise_name = 'Barbell Shrug'              WHERE exercise_name = 'Shrug';
UPDATE session_exercises SET exercise_name = 'Barbell Skull Crusher'      WHERE exercise_name = 'Skull Crusher';
UPDATE session_exercises SET exercise_name = 'Cable Overhead Tricep Extension' WHERE exercise_name = 'Overhead Tricep Ext';
UPDATE session_exercises SET exercise_name = 'Barbell Romanian Deadlift'  WHERE exercise_name = 'Romanian Deadlift';
UPDATE session_exercises SET exercise_name = 'Barbell Bulgarian Split Squat' WHERE exercise_name = 'Bulgarian Split Squat';
UPDATE session_exercises SET exercise_name = 'Barbell Glute Bridge'       WHERE exercise_name = 'Glute Bridge';
UPDATE session_exercises SET exercise_name = 'Dumbbell Wrist Curl'        WHERE exercise_name = 'Wrist Curl';
UPDATE session_exercises SET exercise_name = 'Barbell Preacher Curl'      WHERE exercise_name = 'Preacher Curl';

-- ─── SECTION 3: Update exercise_logs references (history) ────────────────────

UPDATE exercise_logs SET exercise_name = 'Barbell Squat'              WHERE exercise_name = 'Squat';
UPDATE exercise_logs SET exercise_name = 'Barbell Deadlift'           WHERE exercise_name = 'Deadlift';
UPDATE exercise_logs SET exercise_name = 'Barbell Front Squat'        WHERE exercise_name IN ('Front Squat', 'Front Barbell Squat');
UPDATE exercise_logs SET exercise_name = 'Barbell Good Morning'       WHERE exercise_name = 'Good Morning';
UPDATE exercise_logs SET exercise_name = 'Barbell Hip Thrust'         WHERE exercise_name IN ('Hip Thrust', 'Hip Thrusts');
UPDATE exercise_logs SET exercise_name = 'Dumbbell Hammer Curl'       WHERE exercise_name = 'Hammer Curl';
UPDATE exercise_logs SET exercise_name = 'Barbell Bench Press'        WHERE exercise_name = 'Bench Press';
UPDATE exercise_logs SET exercise_name = 'Bent-Over Barbell Row'      WHERE exercise_name IN ('Barbell Row', 'Bent Over Barbell Row');
UPDATE exercise_logs SET exercise_name = 'Machine Calf Raise'         WHERE exercise_name IN ('Calf Raise', 'Calf Raises');
UPDATE exercise_logs SET exercise_name = 'Barbell Overhead Press'     WHERE exercise_name = 'Overhead Press';
UPDATE exercise_logs SET exercise_name = 'Dumbbell Lateral Raise'     WHERE exercise_name IN ('Lateral Raise', 'DB Lateral Raises');
UPDATE exercise_logs SET exercise_name = 'Dumbbell Front Raise'       WHERE exercise_name = 'Front Raise';
UPDATE exercise_logs SET exercise_name = 'Dumbbell Reverse Fly'       WHERE exercise_name = 'Reverse Fly';
UPDATE exercise_logs SET exercise_name = 'Barbell Upright Row'        WHERE exercise_name = 'Upright Row';
UPDATE exercise_logs SET exercise_name = 'Barbell Shrug'              WHERE exercise_name = 'Shrug';
UPDATE exercise_logs SET exercise_name = 'Barbell Skull Crusher'      WHERE exercise_name = 'Skull Crusher';
UPDATE exercise_logs SET exercise_name = 'Cable Overhead Tricep Extension' WHERE exercise_name = 'Overhead Tricep Ext';
UPDATE exercise_logs SET exercise_name = 'Barbell Romanian Deadlift'  WHERE exercise_name = 'Romanian Deadlift';
UPDATE exercise_logs SET exercise_name = 'Barbell Bulgarian Split Squat' WHERE exercise_name = 'Bulgarian Split Squat';
UPDATE exercise_logs SET exercise_name = 'Barbell Glute Bridge'       WHERE exercise_name = 'Glute Bridge';
UPDATE exercise_logs SET exercise_name = 'Dumbbell Wrist Curl'        WHERE exercise_name = 'Wrist Curl';
UPDATE exercise_logs SET exercise_name = 'Barbell Preacher Curl'      WHERE exercise_name = 'Preacher Curl';

-- ─── SECTION 4: Update personal_records references ───────────────────────────

UPDATE personal_records SET exercise_name = 'Barbell Squat'              WHERE exercise_name = 'Squat';
UPDATE personal_records SET exercise_name = 'Barbell Deadlift'           WHERE exercise_name = 'Deadlift';
UPDATE personal_records SET exercise_name = 'Barbell Front Squat'        WHERE exercise_name IN ('Front Squat', 'Front Barbell Squat');
UPDATE personal_records SET exercise_name = 'Barbell Good Morning'       WHERE exercise_name = 'Good Morning';
UPDATE personal_records SET exercise_name = 'Barbell Hip Thrust'         WHERE exercise_name IN ('Hip Thrust', 'Hip Thrusts');
UPDATE personal_records SET exercise_name = 'Dumbbell Hammer Curl'       WHERE exercise_name = 'Hammer Curl';
UPDATE personal_records SET exercise_name = 'Barbell Bench Press'        WHERE exercise_name = 'Bench Press';
UPDATE personal_records SET exercise_name = 'Bent-Over Barbell Row'      WHERE exercise_name IN ('Barbell Row', 'Bent Over Barbell Row');
UPDATE personal_records SET exercise_name = 'Machine Calf Raise'         WHERE exercise_name IN ('Calf Raise', 'Calf Raises');
UPDATE personal_records SET exercise_name = 'Barbell Overhead Press'     WHERE exercise_name = 'Overhead Press';
UPDATE personal_records SET exercise_name = 'Dumbbell Lateral Raise'     WHERE exercise_name IN ('Lateral Raise', 'DB Lateral Raises');
UPDATE personal_records SET exercise_name = 'Dumbbell Front Raise'       WHERE exercise_name = 'Front Raise';
UPDATE personal_records SET exercise_name = 'Dumbbell Reverse Fly'       WHERE exercise_name = 'Reverse Fly';
UPDATE personal_records SET exercise_name = 'Barbell Upright Row'        WHERE exercise_name = 'Upright Row';
UPDATE personal_records SET exercise_name = 'Barbell Shrug'              WHERE exercise_name = 'Shrug';
UPDATE personal_records SET exercise_name = 'Barbell Skull Crusher'      WHERE exercise_name = 'Skull Crusher';
UPDATE personal_records SET exercise_name = 'Cable Overhead Tricep Extension' WHERE exercise_name = 'Overhead Tricep Ext';
UPDATE personal_records SET exercise_name = 'Barbell Romanian Deadlift'  WHERE exercise_name = 'Romanian Deadlift';
UPDATE personal_records SET exercise_name = 'Barbell Bulgarian Split Squat' WHERE exercise_name = 'Bulgarian Split Squat';
UPDATE personal_records SET exercise_name = 'Barbell Glute Bridge'       WHERE exercise_name = 'Glute Bridge';
UPDATE personal_records SET exercise_name = 'Dumbbell Wrist Curl'        WHERE exercise_name = 'Wrist Curl';
UPDATE personal_records SET exercise_name = 'Barbell Preacher Curl'      WHERE exercise_name = 'Preacher Curl';

-- ─── SECTION 5: Delete old generic library entries ────────────────────────────
-- Safe to delete now — all references have been updated above.

DELETE FROM exercise_library WHERE name IN (
  'Squat', 'Deadlift', 'Front Squat', 'Front Barbell Squat',
  'Good Morning', 'Hip Thrust', 'Hip Thrusts',
  'Hammer Curl', 'Bench Press',
  'Barbell Row', 'Bent Over Barbell Row',
  'Calf Raise', 'Calf Raises',
  'Overhead Press', 'Lateral Raise', 'DB Lateral Raises',
  'Front Raise', 'Reverse Fly', 'Upright Row',
  'Shrug', 'Skull Crusher', 'Overhead Tricep Ext',
  'Romanian Deadlift', 'Bulgarian Split Squat',
  'Glute Bridge', 'Wrist Curl', 'Preacher Curl'
);

-- ─── SECTION 6: Clear stale GIF cache ─────────────────────────────────────────
-- Deleted entries and renamed entries need fresh GIF lookups.

DELETE FROM exercise_gif_cache WHERE exercise_name IN (
  -- Old generic names being deleted
  'Squat', 'Deadlift', 'Front Squat', 'Front Barbell Squat',
  'Good Morning', 'Hip Thrust', 'Hip Thrusts',
  'Hammer Curl', 'Bench Press',
  'Barbell Row', 'Bent Over Barbell Row',
  'Calf Raise', 'Calf Raises',
  'Overhead Press', 'Lateral Raise', 'DB Lateral Raises',
  'Front Raise', 'Reverse Fly', 'Upright Row',
  'Shrug', 'Skull Crusher', 'Overhead Tricep Ext',
  'Romanian Deadlift', 'Bulgarian Split Squat',
  'Glute Bridge', 'Wrist Curl', 'Preacher Curl',
  -- New names that may have been cached from a displayName lookup before this migration
  'Barbell Squat', 'Barbell Deadlift', 'Barbell Front Squat', 'Barbell Good Morning',
  'Barbell Hip Thrust', 'Dumbbell Hammer Curl', 'Barbell Bench Press',
  'Bent-Over Barbell Row', 'Machine Calf Raise', 'Barbell Calf Raise', 'Dumbbell Calf Raise',
  'Barbell Overhead Press', 'Dumbbell Overhead Press',
  'Dumbbell Lateral Raise', 'Cable Lateral Raise',
  'Dumbbell Front Raise', 'Cable Front Raise',
  'Dumbbell Reverse Fly', 'Cable Reverse Fly',
  'Barbell Upright Row', 'Cable Upright Row',
  'Barbell Shrug', 'Dumbbell Shrug',
  'Barbell Skull Crusher', 'Dumbbell Skull Crusher',
  'Cable Overhead Tricep Extension', 'Dumbbell Overhead Tricep Extension',
  'Barbell Romanian Deadlift', 'Dumbbell Romanian Deadlift',
  'Barbell Bulgarian Split Squat', 'Dumbbell Bulgarian Split Squat',
  'Barbell Glute Bridge', 'Bodyweight Glute Bridge',
  'Dumbbell Wrist Curl', 'Barbell Wrist Curl',
  'Barbell Preacher Curl'
);
