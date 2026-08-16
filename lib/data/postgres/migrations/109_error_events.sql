CREATE TABLE IF NOT EXISTS error_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  source     TEXT NOT NULL CHECK (source IN ('client', 'server')),
  message    TEXT NOT NULL,
  stack      TEXT,
  url        TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS error_events_created_at_idx ON error_events (created_at DESC);
