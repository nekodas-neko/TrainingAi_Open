-- Per-segment stats for a guided interval walk (avg/max HR, HR at segment start, avg pace,
-- distance, avg cadence) — the same granularity a workout's set_logs get per set, so a walk's
-- fast/slow blocks have real numbers to compare and average across walks, not just an ephemeral
-- live display that was thrown away on save.
--
-- Additive only, mirrors the elevation_profile/pace_series/splits JSONB-array-on-activity_logs
-- pattern (migration 151) rather than a new relational table/sync domain — one more field
-- through the same write paths those already go through.
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS segments JSONB;
