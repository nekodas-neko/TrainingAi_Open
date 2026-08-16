CREATE TABLE IF NOT EXISTS oura_workouts (
  id              TEXT          PRIMARY KEY,
  user_id         UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day             DATE          NOT NULL,
  activity        TEXT          NOT NULL,
  start_datetime  TIMESTAMPTZ   NOT NULL,
  end_datetime    TIMESTAMPTZ   NOT NULL,
  calories        DOUBLE PRECISION,
  distance_m      DOUBLE PRECISION,
  intensity       TEXT,
  source          TEXT,
  reviewed        BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS oura_workouts_user_day ON oura_workouts(user_id, day DESC);
