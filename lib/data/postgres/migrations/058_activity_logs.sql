-- Activity tracking: replace cardio_sessions with activity_logs + a global activity_types catalog.

CREATE TABLE IF NOT EXISTS activity_types (
  id                TEXT PRIMARY KEY,
  label             TEXT NOT NULL,
  icon              TEXT NOT NULL,
  is_distance_based BOOLEAN NOT NULL DEFAULT false,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO activity_types (id, label, icon, is_distance_based, sort_order) VALUES
  ('walk',    'Walk',       'PersonSimpleWalk',   true,  0),
  ('run',     'Run',        'PersonSimpleRun',    true,  1),
  ('cycle',   'Cycle',      'PersonSimpleBike',   true,  2),
  ('hike',    'Hike',       'PersonSimpleHike',   true,  3),
  ('swim',    'Swim',       'PersonSimpleSwim',   true,  4),
  ('yoga',    'Yoga',       'PersonSimpleTaiChi', false, 5),
  ('stretch', 'Stretching', 'PersonSimple',       false, 6),
  ('hiit',    'HIIT',       'Lightning',          false, 7),
  ('other',   'Other',      'DotsThreeCircle',    false, 8)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS activity_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  activity_type   TEXT NOT NULL DEFAULT 'other' REFERENCES activity_types(id),
  title           TEXT NOT NULL,
  start_time      TIME,
  end_time        TIME,
  duration_min    DOUBLE PRECISION,
  distance_km     DOUBLE PRECISION,
  calories_burned DOUBLE PRECISION,
  avg_hr          INTEGER,
  max_hr          INTEGER,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_al_user_date ON activity_logs (user_id, date DESC);

-- One-time migration of existing cardio_sessions data, then drop the old table.
DO $$
BEGIN
  IF to_regclass('cardio_sessions') IS NOT NULL THEN
    INSERT INTO activity_logs (id, user_id, date, activity_type, title, start_time, end_time, duration_min, calories_burned, created_at)
    SELECT id, user_id, date, 'other', title, start_time, end_time, duration_min, calories_burned, created_at
    FROM cardio_sessions;

    DROP TABLE cardio_sessions;
  END IF;
END $$;
