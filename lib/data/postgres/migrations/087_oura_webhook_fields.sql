-- Add oura_user_id (for webhook user lookup) and webhook_signing_key (for payload verification)
ALTER TABLE oura_tokens
  ADD COLUMN IF NOT EXISTS oura_user_id        TEXT,
  ADD COLUMN IF NOT EXISTS webhook_signing_key TEXT;

-- Index so we can look up our user from an incoming webhook's oura_user_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_oura_tokens_oura_user_id ON oura_tokens (oura_user_id)
  WHERE oura_user_id IS NOT NULL;
