-- #2469. The ring link's own counters, recorded server-side.
--
-- `OuraRingService` counts connects, drops and connected time, and kept all three in memory. Found
-- by the #2467 battery investigation: during a gap in `oura_ble_battery_poll` the server could not
-- tell "the link was down" from "the phone had no network", and reconnect churn (estimated at
-- 3-8 %/day of battery) could not be measured at all.
--
-- The counters are CUMULATIVE SINCE THE SERVICE STARTED, exactly as the service holds them. They
-- reset when Android restarts the service, so every row also carries `service_started_at`, the
-- wall-clock instant that service instance began (the device computes it as now - uptime, so two
-- rows from one instance agree to within the bridge's few milliseconds; compare with a tolerance
-- of seconds, never equality). A reader groups rows by that instant and differences within a
-- group; a new instant, or an uptime that went backwards, is a restart and a fresh baseline.
-- Deltas were rejected because a lost post would lose its delta for good, while a lost cumulative
-- row costs nothing: the next one carries the same totals.
--
-- `recorded_at` is server-stamped. The device posts when the app is open, so between two rows of
-- one service instance, (total_connected_ms difference) / (recorded_at difference) is the share of
-- that gap the link was up, which is the question the battery gap could not answer.
--
-- Additive: a new table and its index, nothing else touched.
CREATE TABLE IF NOT EXISTS oura_ble_link_stats (
  id                       BIGSERIAL PRIMARY KEY,
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recorded_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  service_started_at       TIMESTAMPTZ NOT NULL,
  service_uptime_ms        BIGINT NOT NULL,
  -- Free text, like `strap_status.state`: the states belong to the service, and a new one must be
  -- recordable without a migration.
  state                    TEXT NOT NULL,
  connect_count            INTEGER NOT NULL,
  drop_count               INTEGER NOT NULL,
  total_connected_ms       BIGINT NOT NULL,
  last_time_to_connect_ms  INTEGER,
  consecutive_failures     INTEGER
);

CREATE INDEX IF NOT EXISTS oura_ble_link_stats_user_time_idx
  ON oura_ble_link_stats (user_id, recorded_at DESC);

COMMENT ON TABLE oura_ble_link_stats IS
  '#2469: OuraRingService connect/drop/connected-time counters, cumulative since service_started_at '
  '(they reset with the service). recorded_at is server-stamped. Group by service_started_at '
  '(seconds tolerance) and difference within a group.';
