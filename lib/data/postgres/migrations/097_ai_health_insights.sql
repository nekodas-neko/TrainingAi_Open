CREATE TABLE IF NOT EXISTS ai_health_insights (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section     TEXT        NOT NULL,
  date        DATE        NOT NULL,
  insight     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, section, date)
);
