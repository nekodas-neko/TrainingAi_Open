-- 133_oura_ble_battery_poll.sql — live keepalive battery poll time-series.
-- The native service already polls battery every 5 min while connected (OuraRingService keepalive,
-- 0c 00 → 0d 06) but only used it for the notification; this persists it so active-use drain rate
-- (e.g. the ~4%/hr observed while streaming) is captured. Distinct from the forward-only 0x61
-- history telemetry (oura_raw_samples): this is fine-grained and only present while the app holds
-- the BLE link. measured_at is server-stamped at receive (the poll is live, so receive ≈ measure).
CREATE TABLE IF NOT EXISTS oura_ble_battery_poll (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  percent     INTEGER NOT NULL,
  charging    BOOLEAN
);
CREATE INDEX IF NOT EXISTS oura_ble_battery_poll_user_time_idx
  ON oura_ble_battery_poll (user_id, measured_at DESC);
