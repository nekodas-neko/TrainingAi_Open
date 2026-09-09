-- Q-44 Phase 3, PR 1 — rename the vendor-named tables, keep the old names working.
--
-- `ALTER TABLE … RENAME` is catalogue-only: instant even on large tables, no data copy, no row
-- rewrite. The compatibility VIEW is what makes it safe to deploy. Railway can have an old
-- container and a new one overlapping, and a `SELECT *` view over a single table is
-- auto-updatable in Postgres, so code that still names the old table keeps reading AND writing
-- through it. Without the view this is a hard cutover with a window where one container queries a
-- table that has moved.
--
-- **The write shapes were proven against this schema before the migration was written**, not
-- assumed: plain INSERT, UPDATE, composite-column `ON CONFLICT DO UPDATE` (three of the four
-- conflict call sites use a composite target) and `ON CONFLICT … DO UPDATE … WHERE` all work
-- through an auto-updatable view. That mattered — `ON CONFLICT` on a view is a plausible-sounding
-- limitation, and if it had been real the whole compatibility story would have collapsed here.
--
-- TWO TABLES ARE DELIBERATELY NOT RENAMED, and a later sweep must not "finish the job":
--   · `oura_tokens`      — these really are Oura Cloud OAuth/PAT credentials.
--   · `oura_raw_samples` — reverse-engineered BLE frames of THAT ring, decoded by a protocol pinned
--                          to THAT firmware. `sensor_raw_samples` would imply a shared frame format
--                          that does not exist; a Polar H10 frame and an Oura frame have nothing in
--                          common. Renaming it would make the schema less honest, not more.
--
-- Indexes and constraints keep their old names through a table rename, so they are renamed here
-- too. Cosmetic, but a half-renamed catalogue is what makes the next reader think the rename
-- failed part way.
--
-- Code still uses the OLD names in this PR — that is the point. PR 2 moves the code; PR 3 drops
-- these views once an APK carrying the new sync-domain strings is installed and production has run
-- clean. Do not drop them earlier: an installed APK keeps emitting the old domain strings until the
-- owner reinstalls.

ALTER TABLE oura_daily_summary RENAME TO sensor_daily_summary;
ALTER TABLE sensor_daily_summary RENAME CONSTRAINT oura_daily_summary_pkey TO sensor_daily_summary_pkey;
ALTER TABLE sensor_daily_summary RENAME CONSTRAINT oura_daily_summary_user_id_date_key TO sensor_daily_summary_user_id_date_key;
ALTER TABLE sensor_daily_summary RENAME CONSTRAINT oura_daily_summary_user_id_fkey TO sensor_daily_summary_user_id_fkey;
ALTER INDEX oura_daily_summary_user_date_idx RENAME TO sensor_daily_summary_user_date_idx;
CREATE VIEW oura_daily_summary AS SELECT * FROM sensor_daily_summary;

ALTER TABLE oura_daily_derived RENAME TO sensor_daily_derived;
ALTER TABLE sensor_daily_derived RENAME CONSTRAINT oura_daily_derived_pkey TO sensor_daily_derived_pkey;
ALTER TABLE sensor_daily_derived RENAME CONSTRAINT oura_daily_derived_user_id_day_key TO sensor_daily_derived_user_id_day_key;
ALTER TABLE sensor_daily_derived RENAME CONSTRAINT oura_daily_derived_user_id_fkey TO sensor_daily_derived_user_id_fkey;
ALTER INDEX oura_daily_derived_user_day_idx RENAME TO sensor_daily_derived_user_day_idx;
CREATE VIEW oura_daily_derived AS SELECT * FROM sensor_daily_derived;

ALTER TABLE oura_daily RENAME TO sensor_daily;
ALTER TABLE sensor_daily RENAME CONSTRAINT oura_daily_pkey TO sensor_daily_pkey;
ALTER TABLE sensor_daily RENAME CONSTRAINT oura_daily_user_id_date_key TO sensor_daily_user_id_date_key;
ALTER TABLE sensor_daily RENAME CONSTRAINT oura_daily_user_id_fkey TO sensor_daily_user_id_fkey;
ALTER INDEX idx_oura_daily_user_date RENAME TO idx_sensor_daily_user_date;
CREATE VIEW oura_daily AS SELECT * FROM sensor_daily;

ALTER TABLE oura_heartrate RENAME TO sensor_heartrate;
ALTER TABLE sensor_heartrate RENAME CONSTRAINT oura_heartrate_pkey TO sensor_heartrate_pkey;
ALTER TABLE sensor_heartrate RENAME CONSTRAINT oura_heartrate_user_id_fkey TO sensor_heartrate_user_id_fkey;
ALTER TABLE sensor_heartrate RENAME CONSTRAINT oura_heartrate_user_id_timestamp_key TO sensor_heartrate_user_id_timestamp_key;
CREATE VIEW oura_heartrate AS SELECT * FROM sensor_heartrate;

ALTER TABLE oura_workouts RENAME TO sensor_workouts;
ALTER TABLE sensor_workouts RENAME CONSTRAINT oura_workouts_pkey TO sensor_workouts_pkey;
ALTER TABLE sensor_workouts RENAME CONSTRAINT oura_workouts_user_id_fkey TO sensor_workouts_user_id_fkey;
ALTER INDEX oura_workouts_user_day RENAME TO sensor_workouts_user_day;
CREATE VIEW oura_workouts AS SELECT * FROM sensor_workouts;

ALTER TABLE oura_tags RENAME TO sensor_tags;
ALTER TABLE sensor_tags RENAME CONSTRAINT oura_tags_oura_id_key TO sensor_tags_oura_id_key;
ALTER TABLE sensor_tags RENAME CONSTRAINT oura_tags_pkey TO sensor_tags_pkey;
ALTER TABLE sensor_tags RENAME CONSTRAINT oura_tags_user_id_fkey TO sensor_tags_user_id_fkey;
ALTER INDEX idx_oura_tags_user_day RENAME TO idx_sensor_tags_user_day;
CREATE VIEW oura_tags AS SELECT * FROM sensor_tags;

ALTER TABLE oura_bucket RENAME TO sensor_bucket;
ALTER TABLE sensor_bucket RENAME CONSTRAINT oura_bucket_pkey TO sensor_bucket_pkey;
ALTER TABLE sensor_bucket RENAME CONSTRAINT oura_bucket_user_id_fkey TO sensor_bucket_user_id_fkey;
ALTER TABLE sensor_bucket RENAME CONSTRAINT oura_bucket_user_id_tier_bucket_start_ms_key TO sensor_bucket_user_id_tier_bucket_start_ms_key;
ALTER INDEX oura_bucket_user_updated RENAME TO sensor_bucket_user_updated;
CREATE VIEW oura_bucket AS SELECT * FROM sensor_bucket;

ALTER TABLE oura_daytime_hrv_model RENAME TO daytime_hrv_model;
ALTER TABLE daytime_hrv_model RENAME CONSTRAINT oura_daytime_hrv_model_pkey TO daytime_hrv_model_pkey;
ALTER TABLE daytime_hrv_model RENAME CONSTRAINT oura_daytime_hrv_model_user_id_fkey TO daytime_hrv_model_user_id_fkey;
CREATE VIEW oura_daytime_hrv_model AS SELECT * FROM daytime_hrv_model;

ALTER TABLE oura_accel_chunks RENAME TO sensor_accel_chunks;
ALTER TABLE sensor_accel_chunks RENAME CONSTRAINT oura_accel_chunks_pkey TO sensor_accel_chunks_pkey;
ALTER TABLE sensor_accel_chunks RENAME CONSTRAINT oura_accel_chunks_user_id_fkey TO sensor_accel_chunks_user_id_fkey;
ALTER TABLE sensor_accel_chunks RENAME CONSTRAINT oura_accel_chunks_user_id_started_at_key TO sensor_accel_chunks_user_id_started_at_key;
ALTER INDEX oura_accel_chunks_user_created_idx RENAME TO sensor_accel_chunks_user_created_idx;
CREATE VIEW oura_accel_chunks AS SELECT * FROM sensor_accel_chunks;

ALTER TABLE oura_ble_battery_poll RENAME TO ring_battery_poll;
ALTER TABLE ring_battery_poll RENAME CONSTRAINT oura_ble_battery_poll_pkey TO ring_battery_poll_pkey;
ALTER TABLE ring_battery_poll RENAME CONSTRAINT oura_ble_battery_poll_user_id_fkey TO ring_battery_poll_user_id_fkey;
ALTER INDEX oura_ble_battery_poll_user_time_idx RENAME TO ring_battery_poll_user_time_idx;
CREATE VIEW oura_ble_battery_poll AS SELECT * FROM ring_battery_poll;

ALTER TABLE oura_ble_clock_anchors RENAME TO ring_clock_anchors;
ALTER TABLE ring_clock_anchors RENAME CONSTRAINT oura_ble_clock_anchors_pkey TO ring_clock_anchors_pkey;
ALTER TABLE ring_clock_anchors RENAME CONSTRAINT oura_ble_clock_anchors_user_id_fkey TO ring_clock_anchors_user_id_fkey;
ALTER INDEX idx_oura_ble_clock_anchors_epoch RENAME TO idx_ring_clock_anchors_epoch;
ALTER INDEX idx_oura_ble_clock_anchors_user RENAME TO idx_ring_clock_anchors_user;
CREATE VIEW oura_ble_clock_anchors AS SELECT * FROM ring_clock_anchors;

