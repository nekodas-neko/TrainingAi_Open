-- #3718 — how often the daily check's three new rest signals would have suggested rest over the last
-- 90 local days (yesterday back), through the owner-scoped claude_ro views. READ-ONLY, one SELECT,
-- COUNTS ONLY: no value, date or name is returned.
--
-- Columns: signal · evaluable_days (its inputs present and fresh) · flagged · already_suggested (the
-- check already suggested rest that day for another reason) · workout_done (a session with a logged
-- exercise was done that day). The last row, `any`, counts days at least one signal fired.
--
-- The cuts are the `p` row, pinned to the shared constants by
-- packages/shared/src/ai-periodization/__tests__/rest-signals-replay-3718.test.ts.
--
-- WHERE THIS DIFFERS FROM THE APP (the exact count is scripts/tuning/rest-signals-replay.cjs, which
-- runs the shipped code against a local database or a restored backup):
--  * Sleep: the app reads the trend of OUR sleep score, computed in code from each night's stages,
--    latency and timing; SQL cannot compute it, so this uses the duration trend (the prompt's
--    fallback, `sleep_trend`), one row per wake date (its longest), partial nights skipped. Naps that
--    the app's night picker drops can count here.
--  * HRV and blood oxygen: the device is the newest row's `source_map` key, as in the app, but rows
--    with no key are not inferred to a device and the algorithm-version grouping (#3601) is skipped.
--  * Readiness: exact (own-composite rows only, the cut for the row's own scale).
--  * Already suggested: fever or elevated illness radar, three training days in a row, a sick or
--    low/drained check-in. The raised-temperature arm needs the trusted temperature baseline (TN-18),
--    which SQL does not rebuild, so this column is a floor.
WITH p AS (
  SELECT 45 AS readiness_below_v18, 40 AS readiness_below_v17, 18 AS centre_75_from_model,
         0.75::float8 AS sleep_below, 0.75::float8 AS hrv_below, 0.97::float8 AS spo2_below, 18 AS min_wear_hours
), tz AS (
  SELECT coalesce((SELECT timezone FROM claude_ro.users LIMIT 1), 'Australia/Brisbane') AS tz
), days AS (
  SELECT g::date AS day
    FROM tz, generate_series((now() AT TIME ZONE tz.tz)::date - 90, (now() AT TIME ZONE tz.tz)::date - 1, interval '1 day') g
), m AS (
  SELECT 'hrv' AS k, date, hrv_ms::float8 AS v, source_map ->> 'hrv_ms' AS src
    FROM claude_ro.body_metrics WHERE deleted_at IS NULL AND hrv_ms > 0
  UNION ALL
  SELECT 'spo2', date, spo2_pct::float8, source_map ->> 'spo2_pct'
    FROM claude_ro.body_metrics WHERE deleted_at IS NULL AND spo2_pct > 0
  UNION ALL
  SELECT 'sleep', date, max(duration_hours)::float8, NULL
    FROM claude_ro.sleep_sessions WHERE deleted_at IS NULL AND partial_night_at IS NULL AND duration_hours > 0
   GROUP BY date
), w AS (
  -- The 14 days up to and including each day, as the app reads them.
  SELECT d.day, m.k, m.date, m.v, coalesce(m.src, '') AS src,
         (m.k = 'hrv' AND od.non_wear_time_sec IS NOT NULL
           AND (86400 - od.non_wear_time_sec) / 3600.0 < (SELECT min_wear_hours FROM p)) AS low_wear
    FROM days d
    JOIN m ON m.date BETWEEN d.day - 14 AND d.day
    LEFT JOIN claude_ro.oura_daily od ON od.date = m.date
), dev AS (
  SELECT DISTINCT ON (day, k) day, k, src FROM w ORDER BY day, k, date DESC
), r AS (
  SELECT w.*, row_number() OVER (PARTITION BY w.day, w.k ORDER BY w.date DESC) AS rn
    FROM w JOIN dev ON dev.day = w.day AND dev.k = w.k AND dev.src = w.src
), o AS (
  -- The older baseline: after the newest 3, low-wear days out (HRV only), then up to 7.
  SELECT r.*, CASE WHEN rn > 3 AND NOT low_wear
                   THEN row_number() OVER (PARTITION BY day, k, (rn > 3 AND NOT low_wear) ORDER BY date DESC) END AS orn
    FROM r
), t AS (
  SELECT day, k, max(date) AS newest, count(*) AS n,
         avg(v) FILTER (WHERE rn <= 3) AS recent, avg(v) FILTER (WHERE orn <= 7) AS older
    FROM o GROUP BY day, k
), trend AS (
  -- Present and fresh: four nights from the device, a baseline, and the newest night is the day.
  SELECT day, k, CASE WHEN n >= 4 AND older > 0 AND newest = day THEN recent / older END AS ratio FROM t
), rd AS (
  SELECT x.day, x.readiness_score AS s,
         CASE WHEN coalesce(substring(x.model_versions ->> 'readiness' from '^v([0-9]+):')::int, 0) >= p.centre_75_from_model
              THEN p.readiness_below_v18 ELSE p.readiness_below_v17 END AS cut
    FROM claude_ro.oura_daily_derived x, p
   WHERE x.readiness_score IS NOT NULL AND x.readiness_source IN ('ble-derived', 'generic-derived')
), trained AS (
  SELECT DISTINCT (ws.started_at AT TIME ZONE tz.tz)::date AS day
    FROM claude_ro.workout_sessions ws, tz
   WHERE ws.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM claude_ro.exercise_logs e WHERE e.workout_session_id = ws.id AND e.deleted_at IS NULL)
), per_day AS (
  SELECT d.day,
         rd.s IS NOT NULL AS ev_readiness,
         (sl.ratio IS NOT NULL AND hv.ratio IS NOT NULL) AS ev_sleep_hrv,
         sp.ratio IS NOT NULL AS ev_spo2,
         coalesce(rd.s < rd.cut, false) AS readiness_very_low,
         coalesce(sl.ratio < p.sleep_below AND hv.ratio < p.hrv_below, false) AS sleep_and_hrv_low,
         coalesce(sp.ratio < p.spo2_below, false) AS spo2_low,
         (
           (SELECT f FROM (SELECT x.illness_flag AS f FROM claude_ro.oura_daily_derived x
                            WHERE x.day BETWEEN d.day - 1 AND d.day AND x.illness_flag IS NOT NULL
                            ORDER BY x.day DESC LIMIT 1) z) IN ('elevated', 'fever')
           OR (SELECT count(*) FROM trained tr WHERE tr.day BETWEEN d.day - 3 AND d.day - 1) = 3
           OR EXISTS (SELECT 1 FROM claude_ro.mood_logs ml WHERE ml.log_date = d.day AND ml.deleted_at IS NULL
                        AND ('sick' = ANY (ml.body_state) OR ml.energy_level IN ('drained', 'low')))
           OR EXISTS (SELECT 1 FROM claude_ro.day_checkins dc WHERE dc.log_date = d.day AND dc.phase = 'morning'
                        AND dc.deleted_at IS NULL AND dc.illness_context = 'sick')
         ) IS TRUE AS other_reason,
         EXISTS (SELECT 1 FROM trained tr WHERE tr.day = d.day) AS workout_done
    FROM days d CROSS JOIN p
    LEFT JOIN rd ON rd.day = d.day
    LEFT JOIN trend sl ON sl.day = d.day AND sl.k = 'sleep'
    LEFT JOIN trend hv ON hv.day = d.day AND hv.k = 'hrv'
    LEFT JOIN trend sp ON sp.day = d.day AND sp.k = 'spo2'
), sig AS (
  SELECT 1 AS ord, 'readinessVeryLow' AS signal, ev_readiness AS ev, readiness_very_low AS fired, other_reason, workout_done FROM per_day
  UNION ALL SELECT 2, 'sleepAndHrvLow', ev_sleep_hrv, sleep_and_hrv_low, other_reason, workout_done FROM per_day
  UNION ALL SELECT 3, 'spo2Low', ev_spo2, spo2_low, other_reason, workout_done FROM per_day
  UNION ALL SELECT 4, 'any', NULL, readiness_very_low OR sleep_and_hrv_low OR spo2_low, other_reason, workout_done FROM per_day
)
SELECT signal,
       count(*) FILTER (WHERE ev) AS evaluable_days,
       count(*) FILTER (WHERE fired) AS flagged,
       count(*) FILTER (WHERE fired AND other_reason) AS already_suggested,
       count(*) FILTER (WHERE fired AND workout_done) AS workout_done
  FROM sig GROUP BY ord, signal ORDER BY ord;
