CREATE TABLE IF NOT EXISTS injuries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muscle_name TEXT NOT NULL,
  notes TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('mild', 'moderate', 'severe')),
  started_date DATE NOT NULL,
  resolved_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
