-- 122_oura_accel_chunks.sql — raw realtime accel-magnitude chunks from the continuous
-- daytime capture (ring-only accurate step counter, Chunk 1). Each chunk is gait-counted
-- on ingest (countGaitGatedSteps) into step_live_windows; the raw magnitudes are retained
-- for 7 days (pruned opportunistically on ingest, user-scoped) for recount/calibration,
-- then deleted. UNIQUE(user_id, started_at) makes client retries idempotent.
CREATE TABLE IF NOT EXISTS oura_accel_chunks (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  sample_rate INTEGER NOT NULL,
  n INTEGER NOT NULL,
  steps INTEGER NOT NULL,
  magnitudes INTEGER[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, started_at)
);

CREATE INDEX IF NOT EXISTS oura_accel_chunks_user_created_idx
  ON oura_accel_chunks(user_id, created_at);
