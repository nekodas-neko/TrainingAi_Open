CREATE TABLE IF NOT EXISTS oura_heartrate (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  timestamp   TIMESTAMPTZ NOT NULL,
  bpm         INTEGER     NOT NULL,
  source      TEXT,
  UNIQUE(user_id, timestamp)
);

CREATE INDEX IF NOT EXISTS oura_heartrate_user_ts ON oura_heartrate(user_id, timestamp);

ALTER TABLE workout_sessions
  ADD COLUMN IF NOT EXISTS hr_synced_at TIMESTAMPTZ;
