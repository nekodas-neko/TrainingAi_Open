CREATE TABLE IF NOT EXISTS user_stats (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_sessions  INTEGER NOT NULL DEFAULT 0,
  total_volume_kg DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_sets      INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill from existing workout history (sessions with at least one exercise log)
INSERT INTO user_stats (user_id, total_sessions, total_volume_kg, total_sets, updated_at)
SELECT
  ws.user_id,
  COUNT(DISTINCT ws.id)::int,
  COALESCE(SUM(el.volume), 0)::double precision,
  COUNT(sl.id)::int,
  NOW()
FROM workout_sessions ws
JOIN exercise_logs el ON el.workout_session_id = ws.id
LEFT JOIN set_logs sl ON sl.exercise_log_id = el.id
GROUP BY ws.user_id
ON CONFLICT (user_id) DO UPDATE SET
  total_sessions  = EXCLUDED.total_sessions,
  total_volume_kg = EXCLUDED.total_volume_kg,
  total_sets      = EXCLUDED.total_sets,
  updated_at      = NOW();
