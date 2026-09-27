-- LA-142 — remove four `oura_daily_derived` columns that have no writer and no reader.
--
-- Measured on production 2026-09-27: 132 rows, **0 non-null in each of the four**. Nothing is
-- lost because nothing was ever stored; this removes dead weight from the ~40-field sync payload
-- rather than deleting data.
--
-- ⚠ `vascular_age` here is the DERIVED one. `oura_daily.vascular_age` is a different table, IS
-- written, and IS rendered — `getLatestOuraCloudVitals` supplies it to the UI as a deliberate
-- stale surface ("as of <cloudVitalsDate>"). Dropping that one would remove a visible field. This
-- migration must not touch `oura_daily`.
--
-- Reversal is a corrective migration re-adding four nullable columns. Since every value is NULL,
-- re-adding restores the exact prior state — the schema, not the data, is what changes.
--
-- ⚠ THE VIEW MUST GO FIRST, and running this is how that was found rather than reasoned:
-- `claude_ro.oura_daily_derived` SELECTs all four by name, so Postgres refuses every DROP with
-- "cannot drop column ... because other objects depend on it". Without this line the migration
-- fails on production, four times, and leaves the table untouched. The regenerated twin (287)
-- recreates the view without them — the two files are applied in order in the same deploy, so
-- the view is absent only between them.
DROP VIEW IF EXISTS claude_ro.oura_daily_derived;

-- `IF EXISTS` on each so a re-run is a no-op; `ensureSchema` tracks by filename, but a
-- half-applied file should not wedge on the second column.
ALTER TABLE oura_daily_derived DROP COLUMN IF EXISTS active_calories_est;
ALTER TABLE oura_daily_derived DROP COLUMN IF EXISTS worn_hours_ble;
ALTER TABLE oura_daily_derived DROP COLUMN IF EXISTS vascular_age;
ALTER TABLE oura_daily_derived DROP COLUMN IF EXISTS pwv;
