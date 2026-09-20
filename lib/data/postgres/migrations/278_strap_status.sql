-- TN-54. The chest strap went dark on 2026-09-15 and stayed dark for five days, and NOTHING
-- server-side recorded why. Measured: across `rr_intervals` and `oura_heartrate` the last
-- chest-strap sample of any kind is 2026-09-15 23:11 UTC; the ring wrote 455 HR samples the same
-- night through the same phone, app, network and `/api/hr-ingest`, so the ingest path was healthy
-- and only the strap contributed nothing.
--
-- `PolarStrapService` already knows all of this and keeps it in memory. `battery` is a `private
-- var` written once per connection; the give-up path (`stopSelf()` after six consecutive failures)
-- logs "strap not reachable" to `onLog` and reaches no table. Its `status()` object goes to the
-- Capacitor event sink -- the WebView, live -- so a strap that died, ran flat, or never connected
-- is indistinguishable from a strap that was not worn, from every surface except having the app
-- open at the moment it happens.
--
-- Why that is worse than one missing night: PS-44 needs seven nights of PAIRED data and must not
-- count a night until it is in the table. With no status signal the owner cannot tell in the
-- morning whether the night counted, and a seven-night window managed that way takes far longer
-- than seven nights. It has already cost one.
--
-- Shaped on `oura_ble_battery_poll` (migration 133), which is what the ring already does and is
-- the reason the ring's 11,758 battery readings exist while the strap's count is zero.
--
-- `recorded_at` is server-stamped: every row describes a state the service is in AS IT POSTS, so
-- receive is the measurement time. `last_sample_at` is the exception and comes from the device --
-- it is the strap's own last good sample, which is the number that answers "did last night count".
CREATE TABLE IF NOT EXISTS strap_status (
  id                   BIGSERIAL PRIMARY KEY,
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recorded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Free text rather than an enum: the states are the service's own (`idle`, `scanning`,
  -- `connected`, `retrying`, `gave-up`) and adding one must not need a migration to be recorded.
  -- A state this table cannot describe is the failure it exists to catch.
  state                TEXT NOT NULL,
  battery_percent      INTEGER,
  last_sample_at       TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  worn                 BOOLEAN
);

-- The only read is "the owner's latest, and the recent series behind it".
CREATE INDEX IF NOT EXISTS strap_status_user_time_idx
  ON strap_status (user_id, recorded_at DESC);

COMMENT ON TABLE strap_status IS
  'TN-54: one row per PolarStrapService connection attempt or state change. Exists so a dark strap '
  'is distinguishable from an unworn one without the app being open. recorded_at is server-stamped; '
  'last_sample_at is the device''s own last good sample.';
