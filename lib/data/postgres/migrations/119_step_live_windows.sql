-- Accurate live-counted step windows (Tier 2 of the step-orchestration plan). The
-- rollup merges these with the Tier-1 gate estimate: live windows override the
-- estimate for the ds span they cover, the estimate fills the gaps. UNIQUE on
-- (user_id, start_ds) makes client retries of the same window idempotent.
CREATE TABLE IF NOT EXISTS step_live_windows (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_ds   BIGINT NOT NULL,
  end_ds     BIGINT NOT NULL,
  steps      INTEGER NOT NULL,
  source     TEXT NOT NULL DEFAULT 'live-accel',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, start_ds)
);

CREATE INDEX IF NOT EXISTS step_live_windows_user_id_idx ON step_live_windows(user_id);
