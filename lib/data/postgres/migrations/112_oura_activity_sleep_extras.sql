-- Previously fetched-but-dropped Oura fields (F6 chunk 3, item 11): daily_activity's
-- resting_time + MET-minute breakdowns, and sleep's time_in_bed.
ALTER TABLE oura_daily ADD COLUMN IF NOT EXISTS resting_time_sec INTEGER;
ALTER TABLE oura_daily ADD COLUMN IF NOT EXISTS avg_met_minutes DOUBLE PRECISION;
ALTER TABLE oura_daily ADD COLUMN IF NOT EXISTS high_activity_met_minutes DOUBLE PRECISION;
ALTER TABLE oura_daily ADD COLUMN IF NOT EXISTS medium_activity_met_minutes DOUBLE PRECISION;
ALTER TABLE oura_daily ADD COLUMN IF NOT EXISTS low_activity_met_minutes DOUBLE PRECISION;

ALTER TABLE sleep_sessions ADD COLUMN IF NOT EXISTS time_in_bed_hours DOUBLE PRECISION;
