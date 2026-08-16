CREATE TABLE IF NOT EXISTS exercise_media (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_name TEXT NOT NULL,
  gender        TEXT NOT NULL DEFAULT 'male',
  start_url     TEXT,
  end_url       TEXT,
  gif_url       TEXT,
  model_used    TEXT,
  generated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (exercise_name, gender)
);
