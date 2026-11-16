-- #3775 item 3 (owner, 16 Nov 2026): how many of the owner's stored days move when a heart-rate gap
-- inside a workout or activity window counts up to 5.5 min (ACTIVITY_WINDOW_MAX_GAP_SEC = 330 s)
-- instead of 2 (DEFAULT_MAX_GAP_SEC = 120 s). All-day time outside every window keeps the 2-min cap.
-- The rule is `creditGap` in packages/shared/src/health/zone-minutes.ts; this file restates it in SQL
-- to count, and changes nothing.
--
-- READ-ONLY. It reads only the owner-scoped `claude_ro` views and prints counts, medians and maxima,
-- never a heart-rate value. Run it as `claude_ro` (session-start-reads.md), with the owner's current
-- HR profile filled in below. The Orchestrator runs it on production and posts the result on #3775.
--
-- What it reports, one row per measure:
--   zone_minutes          the zone trends (`computeDayZoneSeconds`): minutes across all five zones
--   activity_zone_minutes the Activity score's zone-minutes lane (`activeMinutesFromReadings`, WHO
--                         minutes: moderate once, vigorous twice)
--   heart_health_minutes  the running plan's minutes at or above the moderate floor, per prescription
--                         day (`heartHealthDays`), and how many days' met/not-met verdict flips
-- A day "moves" when its whole-minute figure changes, as the app rounds it.
--
-- Where this is an approximation of the app (each one can only make the count a little high or low):
--   * Health Connect / Apple Health rows are dropped within 5 min of a device row (the merge's
--     aggregator rule); the strap-over-ring 10 s bucketing is not repeated. A strap series has 1 s
--     gaps, which no cap touches, so it adds nothing either way.
--   * The sparse-hour drop (`dropSparseHrHours`) is not repeated: a stretch the app drops as sparse is
--     counted here, at the same 2-min cap before and after, so it cannot move a day by itself.
--   * One HR profile for every day; the app reads each day's resting HR (`restingHrOnDay`).
--   * Heart-health days count every non-deleted log on the day; the app also folds a Health Connect
--     copy of an in-app log into one (`budgetActivityLogs`).
--   * `oura_heartrate` keeps 180 days, so older days are out of reach (and cannot be recomputed by
--     the app either).

WITH p AS (
  SELECT
    (SELECT timezone FROM claude_ro.users LIMIT 1) AS tz,
    181 AS max_hr,      -- replace: the owner's current max HR (resolveHrProfile)
    57  AS resting_hr   -- replace: the owner's current resting HR (resolveHrProfile)
), floors AS (
  -- moderateIntensityBpm / vigorousIntensityBpm: rest + 40% / 60% of reserve, reserve at least 30.
  SELECT tz,
         round(resting_hr + 0.4 * greatest(30, max_hr - resting_hr)) AS moderate_bpm,
         round(resting_hr + 0.6 * greatest(30, max_hr - resting_hr)) AS vigorous_bpm
  FROM p
),
-- ── Workout and activity windows (`activityHrWindows`) ────────────────────────────────────────
raw_windows AS (
  SELECT w.started_at AS w_from, w.completed_at AS w_to
  FROM claude_ro.workout_sessions w
  WHERE w.deleted_at IS NULL AND w.completed_at IS NOT NULL AND w.completed_at > w.started_at
    AND w.completed_at - w.started_at <= interval '240 minutes'
  UNION ALL
  SELECT a.w_from, a.w_to FROM (
    SELECT l.id,
           ((l.date + l.start_time) AT TIME ZONE f.tz) AS w_from,
           CASE
             WHEN l.end_time IS NOT NULL THEN
               CASE WHEN ((l.date + l.end_time) AT TIME ZONE f.tz) > ((l.date + l.start_time) AT TIME ZONE f.tz)
                    THEN ((l.date + l.end_time) AT TIME ZONE f.tz)
                    ELSE (((l.date + 1) + l.end_time) AT TIME ZONE f.tz) END
             WHEN l.duration_min > 0 THEN ((l.date + l.start_time) AT TIME ZONE f.tz) + l.duration_min * interval '1 minute'
           END AS w_to
    FROM claude_ro.activity_logs l CROSS JOIN floors f
    WHERE l.deleted_at IS NULL AND l.start_time IS NOT NULL
  ) a
  WHERE a.w_to IS NOT NULL AND a.w_to > a.w_from
),
-- Merged so an overlap of two windows is never counted twice (`prepareWindows`).
win_marked AS (
  SELECT w_from, w_to,
         CASE WHEN w_from <= max(w_to) OVER (ORDER BY w_from, w_to ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
              THEN 0 ELSE 1 END AS starts_island
  FROM raw_windows
), win_island AS (
  SELECT w_from, w_to, sum(starts_island) OVER (ORDER BY w_from, w_to) AS island FROM win_marked
), windows AS (
  SELECT min(w_from) AS w_from, max(w_to) AS w_to FROM win_island GROUP BY island
),
-- ── The heart-rate series, with the aggregator rule ───────────────────────────────────────────
hr AS (
  SELECT r.timestamp AS ts, r.bpm, (r.timestamp AT TIME ZONE f.tz)::date AS day
  FROM claude_ro.oura_heartrate r CROSS JOIN floors f
  WHERE r.bpm BETWEEN 25 AND 230
    AND NOT (
      r.source IN ('health_connect', 'apple_health')
      AND EXISTS (
        SELECT 1 FROM claude_ro.oura_heartrate d
        WHERE d.source NOT IN ('health_connect', 'apple_health')
          AND d.timestamp BETWEEN r.timestamp - interval '5 minutes' AND r.timestamp + interval '5 minutes'
      )
    )
),
-- Each interval belongs to its earlier reading, inside one local day (the day series is read
-- midnight to midnight).
gaps AS (
  SELECT h.day, h.bpm, h.ts AS t0, lead(h.ts) OVER (PARTITION BY h.day ORDER BY h.ts) AS t1
  FROM hr h
), gap_inside AS (
  SELECT g.day, g.bpm,
         extract(epoch FROM g.t1 - g.t0) AS gap_s,
         coalesce((
           SELECT sum(extract(epoch FROM least(g.t1, w.w_to) - greatest(g.t0, w.w_from)))
           FROM windows w WHERE w.w_from < g.t1 AND w.w_to > g.t0
         ), 0) AS inside_s
  FROM gaps g
  WHERE g.t1 IS NOT NULL AND g.t1 > g.t0
), credited AS (
  SELECT day, bpm,
         least(gap_s, 120) AS old_s,
         CASE WHEN inside_s <= 0 OR gap_s > 330 THEN least(gap_s, 120)
              ELSE least(least(inside_s, 330) + least(gap_s - inside_s, 120), 330) END AS new_s
  FROM gap_inside
),
day_minutes AS (
  SELECT c.day,
         round(sum(c.old_s) / 60.0) AS zone_old,
         round(sum(c.new_s) / 60.0) AS zone_new,
         round(sum(CASE WHEN c.bpm >= f.vigorous_bpm THEN 2 * c.old_s WHEN c.bpm >= f.moderate_bpm THEN c.old_s ELSE 0 END) / 60.0) AS who_old,
         round(sum(CASE WHEN c.bpm >= f.vigorous_bpm THEN 2 * c.new_s WHEN c.bpm >= f.moderate_bpm THEN c.new_s ELSE 0 END) / 60.0) AS who_new
  FROM credited c CROSS JOIN floors f
  GROUP BY c.day
),
-- ── Heart-health minutes: each logged activity's own readings, every gap inside it ─────────────
hh_logs AS (
  SELECT r.date AS day, r.duration_min AS target_min, a.id AS log_id, a.w_from, a.w_to
  FROM claude_ro.prescribed_runs r
  JOIN (
    SELECT l.id, l.date,
           ((l.date + l.start_time) AT TIME ZONE f.tz) AS w_from,
           CASE
             WHEN l.end_time IS NOT NULL THEN
               CASE WHEN ((l.date + l.end_time) AT TIME ZONE f.tz) > ((l.date + l.start_time) AT TIME ZONE f.tz)
                    THEN ((l.date + l.end_time) AT TIME ZONE f.tz)
                    ELSE (((l.date + 1) + l.end_time) AT TIME ZONE f.tz) END
             WHEN l.duration_min > 0 THEN ((l.date + l.start_time) AT TIME ZONE f.tz) + l.duration_min * interval '1 minute'
           END AS w_to
    FROM claude_ro.activity_logs l CROSS JOIN floors f
    WHERE l.deleted_at IS NULL AND l.start_time IS NOT NULL
  ) a ON a.date = r.date AND a.w_to > a.w_from
  WHERE r.deleted_at IS NULL AND r.run_type <> 'walk'
), hh_gaps AS (
  SELECT x.day, x.target_min, x.log_id, h.bpm,
         extract(epoch FROM lead(h.ts) OVER (PARTITION BY x.log_id ORDER BY h.ts) - h.ts) AS gap_s
  FROM hh_logs x JOIN hr h ON h.ts >= x.w_from AND h.ts <= x.w_to
), hh_log_min AS (
  SELECT day, target_min, log_id,
         round(sum(CASE WHEN bpm >= (SELECT moderate_bpm FROM floors) THEN least(gap_s, 120) ELSE 0 END) / 60.0) AS old_min,
         round(sum(CASE WHEN bpm >= (SELECT moderate_bpm FROM floors) THEN (CASE WHEN gap_s <= 330 THEN gap_s ELSE least(gap_s, 120) END) ELSE 0 END) / 60.0) AS new_min
  FROM hh_gaps WHERE gap_s > 0
  GROUP BY day, target_min, log_id
), hh_day AS (
  SELECT day, max(target_min) AS target_min, sum(old_min) AS old_min, sum(new_min) AS new_min
  FROM hh_log_min GROUP BY day
),
-- ── One row per measure ───────────────────────────────────────────────────────────────────────
deltas AS (
  SELECT 'zone_minutes' AS measure, day, zone_new - zone_old AS d, NULL::boolean AS flips FROM day_minutes
  UNION ALL
  SELECT 'activity_zone_minutes', day, who_new - who_old, NULL FROM day_minutes
  UNION ALL
  SELECT 'heart_health_minutes', day, new_min - old_min,
         (target_min > 0 AND (old_min >= round(target_min)) <> (new_min >= round(target_min)))
  FROM hh_day
)
SELECT
  measure,
  count(*)                                                        AS days_measured,
  count(*) FILTER (WHERE d <> 0)                                  AS days_that_move,
  count(*) FILTER (WHERE d <> 0 AND day >= date '2026-10-17')     AS of_which_since_oura_cloud,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY d) FILTER (WHERE d <> 0) AS median_change_min,
  max(d)                                                          AS max_change_min,
  count(*) FILTER (WHERE flips)                                   AS verdicts_that_flip
FROM deltas
GROUP BY measure
ORDER BY measure;
