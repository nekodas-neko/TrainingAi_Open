-- 134_daily_zone_minutes_profile.sql
-- Stamp the HR-zone profile (max_hr, resting_hr) used to compute each cached day of
-- daily_zone_minutes. The zone boundaries are derived from this profile, and the profile
-- drifts over time (resting HR changes with fitness). Without recording it, a day cached
-- under an old profile keeps stale zone splits forever while newer days use current bands —
-- one chart then mixes two zone definitions (review J-2/H-4). getZoneMinutesRange treats a
-- profile mismatch as a cache miss (recompute) for any day still inside HR retention (180d);
-- days older than that can no longer be recomputed and keep their frozen-profile split.
-- Nullable: pre-existing rows have no stamp and are treated as a miss on next read.
ALTER TABLE daily_zone_minutes ADD COLUMN IF NOT EXISTS max_hr     integer;
ALTER TABLE daily_zone_minutes ADD COLUMN IF NOT EXISTS resting_hr integer;
