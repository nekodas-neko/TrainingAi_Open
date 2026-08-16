-- Covering index for the DISTINCT ON pattern used in getLastExerciseLogsBatch:
-- SELECT DISTINCT ON (exercise_name) ... JOIN workout_sessions ... ORDER BY exercise_name, logged_at DESC
-- Including workout_session_id avoids a second heap fetch for the JOIN condition.
DROP INDEX IF EXISTS idx_el_name_date;
CREATE INDEX IF NOT EXISTS idx_el_name_date_ws
  ON exercise_logs (exercise_name, logged_at DESC, workout_session_id);
