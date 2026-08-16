-- day_checkins: End of Day (and later Start of Day) wellness check-ins.
-- One row per (user, day, phase). All scale columns are 1–5, nullable so a
-- partial save is valid. journal is the only free text.
CREATE TABLE IF NOT EXISTS day_checkins (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date            DATE NOT NULL,
  phase               TEXT NOT NULL DEFAULT 'evening',
  physical_tiredness  INTEGER,
  mental_drain        INTEGER,
  barely_moved        INTEGER,
  hydration           INTEGER,
  late_heavy_meal     INTEGER,
  sore_muscles        TEXT[] NOT NULL DEFAULT '{}',
  journal             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,
  UNIQUE (user_id, log_date, phase)
);
CREATE INDEX IF NOT EXISTS idx_day_checkins_user_updated ON day_checkins (user_id, updated_at);
