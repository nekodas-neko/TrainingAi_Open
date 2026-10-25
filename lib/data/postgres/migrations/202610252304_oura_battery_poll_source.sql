-- 202610252304_oura_battery_poll_source.sql — which feed a battery reading came from (#3069).
-- The ring's battery is moving from direct-Bluetooth polls (stopped 17 Oct) to Oura Cloud's
-- ring_battery_level. Both land in this table so the health chart runs on from July. NULL means a
-- Bluetooth poll, which is every existing row; the Oura Cloud reader writes 'oura_cloud'. Catalog-only:
-- no default, no backfill.
ALTER TABLE oura_ble_battery_poll ADD COLUMN IF NOT EXISTS source TEXT;
