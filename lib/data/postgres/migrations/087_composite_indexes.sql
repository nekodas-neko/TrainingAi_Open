-- Composite indexes for common query patterns (idempotent, no CONCURRENTLY)

-- workout_sessions: user history sorted by time
CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_started
  ON workout_sessions(user_id, started_at DESC);

-- exercise_logs: join from workout_sessions + filter by exercise name + sort by date
-- (no user_id column on exercise_logs; user scoping goes through workout_session_id)
CREATE INDEX IF NOT EXISTS idx_exercise_logs_session_exercise_date
  ON exercise_logs(workout_session_id, exercise_name, logged_at DESC);

-- body_metrics: user data sorted by date (separate from unique(user_id,date) which has no DESC)
CREATE INDEX IF NOT EXISTS idx_body_metrics_user_date
  ON body_metrics(user_id, date DESC);

-- sleep_sessions: user sleep sorted by date
CREATE INDEX IF NOT EXISTS idx_sleep_sessions_user_date
  ON sleep_sessions(user_id, date DESC);
