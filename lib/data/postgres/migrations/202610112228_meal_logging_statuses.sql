CREATE TABLE IF NOT EXISTS meal_logging_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meal_type_id UUID NOT NULL REFERENCES meal_types(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  skipped BOOLEAN NOT NULL DEFAULT FALSE,
  decision_id UUID NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, log_date, meal_type_id)
);
