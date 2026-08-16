-- Normalize muscle group names to lowercase everywhere they appear as free-text strings.
-- exercise_library.muscles is the root cause: seeded with Title Case ("Chest", "Shoulders"...)
-- while all other references (session_exercises.muscle_groups, program_volume_targets.muscle_group)
-- use lowercase. This migration lowercases the JSONB in-place and normalizes the two text columns.

UPDATE exercise_library
SET muscles = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'muscle', lower(entry->>'muscle'),
      'role',   entry->>'role'
    )
  )
  FROM jsonb_array_elements(muscles) AS entry
)
WHERE muscles IS NOT NULL;

UPDATE session_exercises
SET muscle_groups = ARRAY(
  SELECT lower(mg) FROM unnest(muscle_groups) AS mg
)
WHERE muscle_groups IS NOT NULL AND array_length(muscle_groups, 1) > 0;

UPDATE exercise_logs
SET muscle_groups = ARRAY(
  SELECT lower(mg) FROM unnest(muscle_groups) AS mg
)
WHERE muscle_groups IS NOT NULL AND array_length(muscle_groups, 1) > 0;
