-- Q-307 — `avg_pace_sec_per_km` was read straight from the column and never derived, so it was
-- absent on 32 of 39 activity logs that carried both `distance_km` and `duration_min` — the
-- inputs the pace formula needs. `saveActivityLog` now derives it server-side when a write omits
-- it (same shape as `caloriesBurned`); this corrects the rows that were already written before
-- that existed.
--
-- Idempotent and narrow, per CLAUDE.md's Postgres data-migration rule: only rows that are missing
-- pace AND carry both inputs AND have a positive distance are touched. A row that already has a
-- pace is never overwritten — a client-supplied or previously-derived value stands.
UPDATE activity_logs
SET avg_pace_sec_per_km = (duration_min * 60.0) / distance_km
WHERE avg_pace_sec_per_km IS NULL
  AND duration_min IS NOT NULL
  AND distance_km IS NOT NULL
  AND distance_km > 0;
