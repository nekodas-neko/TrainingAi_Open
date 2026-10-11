CREATE TABLE IF NOT EXISTS auth_identities (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'apple')),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject),
  UNIQUE (user_id, provider)
);

INSERT INTO auth_identities (user_id, provider, subject, email)
SELECT id, 'google', oauth_sub, email FROM users WHERE oauth_sub IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS apple_auth_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce_hash text NOT NULL UNIQUE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS apple_auth_attempts_expiry_idx ON apple_auth_attempts (expires_at);
