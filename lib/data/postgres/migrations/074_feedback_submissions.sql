CREATE TABLE IF NOT EXISTS feedback_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'other')),
  title TEXT NOT NULL,
  description TEXT,
  screenshot_data TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
