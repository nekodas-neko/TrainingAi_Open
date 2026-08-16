-- Direct-BLE clock anchoring (backlog item 2 Chunk 1): the ring clock is a
-- monotonic deciseconds counter since the ring's own epoch, so raw samples need a
-- persisted (anchor_ds ↔ anchor_utc) correspondence to convert to wall-clock. One
-- row per clock epoch per user (a ring reset inserts a new row; old rows keep
-- dating their epoch's samples). measured_at is the derived convenience stamp.
CREATE TABLE IF NOT EXISTS oura_ble_clock_anchors (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anchor_ds   BIGINT NOT NULL,
  anchor_utc  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oura_ble_clock_anchors_user
  ON oura_ble_clock_anchors (user_id, created_at DESC);

ALTER TABLE oura_raw_samples ADD COLUMN IF NOT EXISTS measured_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_oura_raw_samples_user_measured
  ON oura_raw_samples (user_id, measured_at);
