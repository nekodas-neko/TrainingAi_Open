-- 202610252304_oura_battery_poll_source.sql — which feed a battery reading came from (#3069).
-- The ring's battery is moving from direct-Bluetooth polls (stopped 17 Oct) to Oura Cloud's
-- ring_battery_level. Both land in this table so the health chart runs on from July. NULL means a
-- Bluetooth poll, which is every existing row; the Oura Cloud reader writes 'oura_cloud'. Catalog-only:
-- no default, no backfill.
--
-- Shipped alone (CLAUDE.md: a migration never rides in a batch with anything else). 0 rows change.
--
-- Guards: `lock_timeout` so a long reader on oura_ble_battery_poll makes this give up (and
-- ensureSchema retry on the next boot) rather than queue writers behind it; `statement_timeout` as
-- a backstop. Both are SET LOCAL.
--
-- REVERSE (loses only what later code writes into the column):
--   DROP VIEW IF EXISTS claude_ro.oura_ble_battery_poll; ALTER TABLE oura_ble_battery_poll DROP COLUMN source;
--   (the view selects the column, so the DROP COLUMN fails without the DROP VIEW; the boot rebuild recreates the view from claude-ro-views.sql)

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE oura_ble_battery_poll ADD COLUMN IF NOT EXISTS source TEXT;
