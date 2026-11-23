WITH cfg AS (
  SELECT COALESCE((SELECT u.timezone FROM claude_ro.users u WHERE u.timezone IS NOT NULL LIMIT 1), 'Australia/Brisbane') AS tz
),
win AS (
  SELECT cfg.tz, (now() AT TIME ZONE cfg.tz)::date AS today, (now() AT TIME ZONE cfg.tz)::date - 59 AS from_day FROM cfg
),
syn(raw, canon) AS (
  VALUES ('pecs','chest'),('deltoids','shoulders'),('deltoid','shoulders'),('delts','shoulders'),('quadriceps','quads'),
         ('gluteal','glutes'),('hamstring','hamstrings'),('trapezius','traps'),('forearm','forearms'),
         ('external oblique','obliques'),('core','abs'),('rhomboids','upper back')
),
rf AS (
  SELECT r, ((1 + r / 30.0) + 36.0 / (37 - LEAST(r, 20))) / 2 AS f FROM generate_series(1, 30) AS r
),
ws AS (
  SELECT w.id, w.program_session_id, w.started_at, w.completed_at, (w.started_at AT TIME ZONE win.tz)::date AS d
  FROM claude_ro.workout_sessions w CROSS JOIN win
  WHERE w.deleted_at IS NULL
),
vol AS (
  SELECT ws.id, ws.started_at, COALESCE(SUM(e.volume), 0) AS v
  FROM ws LEFT JOIN claude_ro.exercise_logs e ON e.workout_session_id = ws.id AND e.deleted_at IS NULL
  GROUP BY ws.id, ws.started_at
),
typed AS (
  SELECT ws.*, p.created_at AS program_created, COALESCE(p.started_at::timestamp AT TIME ZONE 'UTC', p.created_at) AS program_began
  FROM ws
  JOIN claude_ro.program_sessions ps ON ps.id = ws.program_session_id
  JOIN claude_ro.programs p ON p.id = ps.program_id
),
ev AS (
  SELECT t.*, (t.d::timestamp AT TIME ZONE win.tz) AS day_mid
  FROM typed t CROSS JOIN win
  WHERE t.d BETWEEN win.from_day AND win.today
),
l5 AS (
  SELECT e.id AS eid, h.id, h.d, h.completed_at, h.rn
  FROM ev e
  CROSS JOIN LATERAL (
    SELECT x.id, x.d, x.completed_at, row_number() OVER (ORDER BY x.started_at DESC, x.id) AS rn
    FROM typed x
    WHERE x.program_session_id = e.program_session_id AND x.started_at >= e.program_created AND x.started_at <= e.started_at
    ORDER BY x.started_at DESC, x.id
    LIMIT 5
  ) h
),
consec AS (
  SELECT e.id AS eid,
         (SELECT MIN(k) FROM generate_series(0, 5) AS k WHERE NOT EXISTS (SELECT 1 FROM l5 WHERE l5.eid = e.id AND l5.d = e.d - k)) AS run_days
  FROM ev e
),
prev_done AS (
  SELECT DISTINCT ON (l5.eid) l5.eid, l5.completed_at
  FROM l5 JOIN ev e ON e.id = l5.eid
  WHERE l5.id <> l5.eid AND l5.completed_at IS NOT NULL
  ORDER BY l5.eid, l5.rn
),
mood AS (
  SELECT e.id AS eid, m.body_state, m.sore_muscles, m.suggested_sore_muscles
  FROM ev e
  CROSS JOIN LATERAL (
    SELECT ml.body_state, ml.sore_muscles, ml.suggested_sore_muscles
    FROM claude_ro.mood_logs ml
    WHERE ml.deleted_at IS NULL AND ml.log_date IN (e.d, e.d - 1)
    ORDER BY ml.log_date DESC
    LIMIT 1
  ) m
),
sore AS (
  SELECT mo.eid, COUNT(*) AS sore_in_session
  FROM mood mo
  CROSS JOIN LATERAL unnest(mo.sore_muscles) WITH ORDINALITY AS sm(label, ord)
  JOIN ev e ON e.id = mo.eid
  CROSS JOIN LATERAL (SELECT COALESCE((SELECT canon FROM syn WHERE raw = lower(trim(sm.label))), lower(trim(sm.label))) AS mm) n
  WHERE 'sore_muscles' = ANY(mo.body_state)
    AND NOT EXISTS (
      SELECT 1 FROM unnest(COALESCE(mo.suggested_sore_muscles, ARRAY[]::text[])) AS sg(label)
      WHERE COALESCE((SELECT canon FROM syn WHERE raw = lower(trim(sg.label))), lower(trim(sg.label))) = n.mm
    )
    AND EXISTS (
      SELECT 1
      FROM claude_ro.session_exercises se
      CROSS JOIN LATERAL unnest(se.muscle_groups) AS mg(label)
      CROSS JOIN LATERAL (SELECT COALESCE((SELECT canon FROM syn WHERE raw = lower(trim(mg.label))), lower(trim(mg.label))) AS em) x
      WHERE se.session_id = e.program_session_id AND se.deleted_at IS NULL
        AND (x.em = n.mm
          OR (n.mm = 'back' AND (x.em LIKE '%back%' OR x.em IN ('lats', 'traps', 'rhomboids')))
          OR (n.mm = 'shoulders' AND (x.em = 'shoulders' OR x.em LIKE '%delt%'))
          OR (n.mm = 'chest' AND (x.em = 'chest' OR x.em LIKE '%pec%'))
          OR (n.mm NOT IN ('back', 'shoulders', 'chest') AND strpos(x.em, n.mm) > 0))
    )
  GROUP BY mo.eid
),
sets AS (
  SELECT l5.eid, l5.rn, sl.rpe, sl.rpe_source, sl.reps, sl.planned_reps, sl.intensity_pct AS pct
  FROM l5
  JOIN claude_ro.exercise_logs el ON el.workout_session_id = l5.id AND el.deleted_at IS NULL
  JOIN claude_ro.set_logs sl ON sl.exercise_log_id = el.id AND sl.deleted_at IS NULL
  WHERE l5.rn <= 3
),
rated AS (
  SELECT s.eid, s.rpe, s.rpe_source, s.reps, s.pct,
         CASE WHEN s.pct <= 0 THEN 30.0
              WHEN s.pct >= 100 THEN 1.0
              WHEN 100.0 / s.pct <= (SELECT f FROM rf WHERE r = 1) THEN 1.0
              WHEN k.r IS NULL THEN 30.0
              ELSE k.r - 1 + (100.0 / s.pct - k.fp) / (k.f - k.fp) END AS max_reps
  FROM sets s
  LEFT JOIN LATERAL (
    SELECT a.r, a.f, b.f AS fp FROM rf a JOIN rf b ON b.r = a.r - 1
    WHERE a.r >= 2 AND a.f >= 100.0 / NULLIF(s.pct, 0)
    ORDER BY a.r LIMIT 1
  ) k ON true
  WHERE s.rpe IS NOT NULL AND s.pct IS NOT NULL
),
rpe AS (
  SELECT eid, AVG(CASE WHEN rpe_source = 'expected' THEN exp ELSE rpe END) - AVG(exp) AS delta
  FROM (
    SELECT eid, rpe, rpe_source,
           CASE WHEN NOT (pct > 0) OR NOT (reps > 0) THEN 7.0
                ELSE LEAST(10.0, GREATEST(5.0, 10 - GREATEST(0, max_reps - reps))) END AS exp
    FROM rated
  ) z
  GROUP BY eid
  HAVING COUNT(*) >= 3
),
reps AS (
  SELECT eid, SUM(reps)::numeric / SUM(planned_reps) AS rate
  FROM sets WHERE rn = 1 AND planned_reps > 0
  GROUP BY eid
),
acwr AS (
  SELECT e.id AS eid,
         SUM(v.v) FILTER (WHERE v.started_at >= ((e.d - 6)::timestamp AT TIME ZONE win.tz)) AS short_kg,
         SUM(v.v) AS long_kg,
         COUNT(v.id) AS n,
         ROUND((EXTRACT(EPOCH FROM e.day_mid - MIN(v.started_at)) / 86400)::numeric) AS span_days,
         FLOOR(EXTRACT(EPOCH FROM e.day_mid - e.program_began) / 86400) AS program_age_days
  FROM ev e CROSS JOIN win
  JOIN vol v ON v.started_at >= ((e.d - 28)::timestamp AT TIME ZONE win.tz) AND v.started_at <= e.started_at
  GROUP BY e.id, e.d, e.day_mid, e.program_began, win.tz
),
fired AS (
  SELECT e.d,
    (EXISTS (SELECT 1 FROM claude_ro.mood_logs ml WHERE ml.deleted_at IS NULL AND ml.log_date = e.d AND 'sick' = ANY(ml.body_state))
      OR EXISTS (SELECT 1 FROM claude_ro.day_checkins dc WHERE dc.deleted_at IS NULL AND dc.log_date = e.d AND dc.phase = 'morning' AND dc.illness_context = 'sick')) AS illness,
    COALESCE(c.run_days >= 4, false) AS consecutive_days,
    COALESCE(EXTRACT(EPOCH FROM e.started_at - pd.completed_at) / 3600 < 36 AND so.sore_in_session >= 3, false) AS soreness,
    COALESCE(a.span_days >= 21 AND a.n >= 6 AND a.long_kg / GREATEST(1, a.span_days / 7.0) > 100 AND a.program_age_days >= 28
      AND COALESCE(a.short_kg, 0) / (a.long_kg / GREATEST(1, a.span_days / 7.0)) > 1.5, false) AS training_load,
    COALESCE(r.delta > 2.0, false) AS effort,
    COALESCE(rp.rate < 0.7, false) AS missed_reps
  FROM ev e
  LEFT JOIN consec c ON c.eid = e.id
  LEFT JOIN prev_done pd ON pd.eid = e.id
  LEFT JOIN sore so ON so.eid = e.id
  LEFT JOIN acwr a ON a.eid = e.id
  LEFT JOIN rpe r ON r.eid = e.id
  LEFT JOIN reps rp ON rp.eid = e.id
),
hits AS (
  SELECT f.d, k.ord, k.hit
  FROM fired f
  CROSS JOIN LATERAL (VALUES
    (1, f.illness), (2, f.consecutive_days), (3, f.soreness), (4, f.training_load), (5, f.effort), (6, f.missed_reps),
    (7, f.illness OR f.consecutive_days OR f.soreness OR f.training_load OR f.effort OR f.missed_reps)
  ) AS k(ord, hit)
  WHERE k.hit
)
SELECT kl.kind AS trigger,
       COUNT(DISTINCT h.d) AS days_fired,
       (SELECT COUNT(DISTINCT d) FROM ev) AS trained_days,
       MIN(h.d) AS first_day,
       MAX(h.d) AS last_day,
       (SELECT from_day FROM win) AS window_from,
       (SELECT tz FROM win) AS tz
FROM (VALUES (1, 'illness'), (2, 'consecutive-days'), (3, 'soreness'), (4, 'training-load'), (5, 'effort'), (6, 'missed-reps'),
             (7, 'any (one-day deload offered)')) AS kl(ord, kind)
LEFT JOIN hits h ON h.ord = kl.ord
GROUP BY kl.ord, kl.kind
ORDER BY kl.ord
