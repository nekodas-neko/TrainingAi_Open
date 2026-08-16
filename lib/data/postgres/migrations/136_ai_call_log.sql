-- AI call observability log. One row per @ai-sdk/google model call, written
-- best-effort (fire-and-forget) by lib/ai/instrument.ts. Metadata only — a
-- section tag, model id, token counts (from the SDK usage), latency, ok/error,
-- and a request fingerprint (hash of section + key inputs). NEVER prompt bodies
-- or health data. Pruned opportunistically from the write path (no cron layer).
CREATE TABLE IF NOT EXISTS ai_call_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  section       TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  total_tokens  INTEGER,
  latency_ms    INTEGER,
  ok            BOOLEAN NOT NULL,
  fingerprint   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_call_log_created_at_idx ON ai_call_log (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_call_log_section_created_idx ON ai_call_log (section, created_at DESC);
-- Double-trip detection groups by (user, section, fingerprint) within a window.
CREATE INDEX IF NOT EXISTS ai_call_log_fingerprint_idx ON ai_call_log (user_id, section, fingerprint, created_at DESC);
