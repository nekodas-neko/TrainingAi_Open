-- Sleep sessions from Health Connect (synced via Capacitor native plugin)
CREATE TABLE IF NOT EXISTS sleep_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date              DATE NOT NULL,             -- date of wake-up (local)
  sleep_start       TIMESTAMPTZ NOT NULL,
  sleep_end         TIMESTAMPTZ NOT NULL,
  duration_hours    DOUBLE PRECISION,
  deep_sleep_hours  DOUBLE PRECISION,
  rem_sleep_hours   DOUBLE PRECISION,
  light_sleep_hours DOUBLE PRECISION,
  awake_hours       DOUBLE PRECISION,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, sleep_start)
);
