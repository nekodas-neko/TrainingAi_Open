CREATE TABLE IF NOT EXISTS exercise_gif_cache (
  exercise_name TEXT PRIMARY KEY,
  gif_url       TEXT,
  image_url     TEXT,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
