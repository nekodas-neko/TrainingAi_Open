-- Oura Ring OAuth / Personal Access Token storage (one row per user)
CREATE TABLE IF NOT EXISTS oura_tokens (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- PAT (Personal Access Token) — simpler, no expiry
  personal_access_token TEXT,
  -- OAuth tokens (if OAuth flow is used instead of PAT)
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    TIMESTAMPTZ,
  scope         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
