-- Allow email/password accounts (no oauth_sub)
ALTER TABLE users ALTER COLUMN oauth_sub DROP NOT NULL;

-- Profile fields on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS height_cm INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS weight_goal_kg DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Invite list
CREATE TABLE IF NOT EXISTS invited_emails (
  email      TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
