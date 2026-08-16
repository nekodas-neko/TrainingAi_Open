CREATE TABLE IF NOT EXISTS personal_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  estimated_1rm DOUBLE PRECISION NOT NULL,
  achieved_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, exercise_name)
);
