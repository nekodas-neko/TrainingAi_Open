-- Seed 4 missing Legs sessions from original Sheets data.
-- Historical one-off, already applied in production. Kept for the record.
-- Safe to re-run: outer DO block will RAISE if user not found.
--
-- The target account is supplied at run time rather than baked in, so this file carries no personal
-- address. From psql:
--     psql "$DATABASE_URL" -v owner_email=you@example.com -f scripts/seed-legs.sql
-- From a console that does not support -v, set the GUC first:
--     SET app.owner_email = 'you@example.com';

DO $$
DECLARE
  v_uid  text;
  ws1    uuid;
  ws2    uuid;
  ws3    uuid;
  ws4    uuid;
  el     uuid;
BEGIN

  SELECT id INTO v_uid FROM users WHERE email = current_setting('app.owner_email', true);
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'User not found — set app.owner_email (see the header) to an existing account';
  END IF;

  -- ── SESSION 1 · 2026-05-05 ────────────────────────────────────────────────
  INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
  VALUES (v_uid, 'Legs', '2026-05-05 08:00:00+00', '2026-05-05 09:00:00+00')
  RETURNING id INTO ws1;

  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws1, 'Single Leg Hip Thrusts', 53.25, 42.5, 800, 10, 182, '{}', '2026-05-05 08:00:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, intensity_pct, use_for_1rm)
  VALUES (el,1,40,10,75.1,true),(el,2,40,10,75.1,true);

  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws1, 'Hip Thrusts', 98, 78.5, 1680, 12, 169, '{}', '2026-05-05 08:10:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, intensity_pct, use_for_1rm)
  VALUES (el,1,70,12,71.4,true),(el,2,70,12,71.4,true);

  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws1, 'Front Barbell Squat', 66.75, 53.5, 1500, 10, 677, '{}', '2026-05-05 08:20:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, intensity_pct, use_for_1rm)
  VALUES (el,1,50,10,74.9,true),(el,2,50,10,74.9,true),(el,3,50,10,74.9,true);

  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws1, 'Romanian Deadlift', 56, 44.75, 1440, 12, 317, '{}', '2026-05-05 08:35:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, intensity_pct, use_for_1rm)
  VALUES (el,1,40,12,71.4,true),(el,2,40,12,71.4,true),(el,3,40,12,71.4,true);

  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws1, 'Calf Raises', 28, 22.5, 720, 12, 185, '{}', '2026-05-05 08:50:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, intensity_pct, use_for_1rm)
  VALUES (el,1,20,12,71.4,true),(el,2,20,12,71.4,true),(el,3,20,12,71.4,true);


  -- ── SESSION 2 · 2026-05-08 ────────────────────────────────────────────────
  INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
  VALUES (v_uid, 'Legs', '2026-05-08 11:56:00+00', '2026-05-08 12:52:00+00')
  RETURNING id INTO ws2;

  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws2, 'Single Leg Hip Thrusts', 56.75, 45.5, 850, 10, 242, '{}', '2026-05-08 11:56:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, intensity_pct, use_for_1rm)
  VALUES (el,1,42.5,10,74.9,true),(el,2,42.5,10,74.9,true);

  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws2, 'Hip Thrusts', 106.75, 85.5, 1600, 10, 191, '{}', '2026-05-08 12:01:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, intensity_pct, use_for_1rm)
  VALUES (el,1,80,10,74.9,true),(el,2,80,10,74.9,true);

  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws2, 'Front Barbell Squat', 70, 56, 1575, 10, 709, '{}', '2026-05-08 12:21:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, intensity_pct, use_for_1rm)
  VALUES (el,1,52.5,10,75,true),(el,2,52.5,10,75,true),(el,3,52.5,10,75,true);

  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws2, 'Romanian Deadlift', 60, 48, 1350, 10, 449, '{}', '2026-05-08 12:30:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, intensity_pct, use_for_1rm)
  VALUES (el,1,45,10,75,true),(el,2,45,10,75,true),(el,3,45,10,75,true);

  -- Calf Raises: reps 15,10,10 → avgReps 11.7
  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws2, 'Calf Raises', 27.75, 22.25, 700, 11.7, 624, '{}', '2026-05-08 12:41:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, intensity_pct, use_for_1rm)
  VALUES (el,1,20,15,72.1,true),(el,2,20,10,72.1,true),(el,3,20,10,72.1,true);


  -- ── SESSION 3 · 2026-05-14 ────────────────────────────────────────────────
  INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
  VALUES (v_uid, 'Legs', '2026-05-14 07:29:00+00', '2026-05-14 08:12:00+00')
  RETURNING id INTO ws3;

  -- reps: 8,10  setTimes: 67,85  restTimes: 101
  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws3, 'Single Leg Hip Thrusts', 58.5, 46.75, 810, 9, 152, '{}', '2026-05-14 07:29:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, set_time_sec, rest_time_sec, intensity_pct, use_for_1rm)
  VALUES (el,1,45,8,67,101,76.9,true),(el,2,45,10,85,NULL,76.9,true);

  -- reps: 10,10  setTimes: 39,40  restTimes: 93
  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws3, 'Hip Thrusts', 113.25, 90.5, 1700, 10, 79, '{}', '2026-05-14 07:37:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, set_time_sec, rest_time_sec, intensity_pct, use_for_1rm)
  VALUES (el,1,85,10,39,93,75.1,true),(el,2,85,10,40,NULL,75.1,true);

  -- reps: 8,8,8  setTimes: 52,54,65  restTimes: 189
  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws3, 'Front Barbell Squat', 69.75, 55.75, 1320, 8, 171, '{}', '2026-05-14 07:51:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, set_time_sec, rest_time_sec, intensity_pct, use_for_1rm)
  VALUES (el,1,55,8,52,189,78.9,true),(el,2,55,8,54,NULL,78.9,true),(el,3,55,8,65,NULL,78.9,true);

  -- reps: 10,10,10  setTimes: 95,80,80  restTimes: 154
  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws3, 'Romanian Deadlift', 66.75, 53.5, 1500, 10, 255, '{}', '2026-05-14 08:01:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, set_time_sec, rest_time_sec, intensity_pct, use_for_1rm)
  VALUES (el,1,50,10,95,154,74.9,true),(el,2,50,10,80,NULL,74.9,true),(el,3,50,10,80,NULL,74.9,true);

  -- reps: 20,20,20  setTimes: 42,56,58  restTimes: 89
  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws3, 'Calf Raises', 37.5, 30, 1350, 20, 156, '{}', '2026-05-14 08:07:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, set_time_sec, rest_time_sec, intensity_pct, use_for_1rm)
  VALUES (el,1,22.5,20,42,89,60,true),(el,2,22.5,20,56,NULL,60,true),(el,3,22.5,20,58,NULL,60,true);


  -- ── SESSION 4 · 2026-05-20 ────────────────────────────────────────────────
  INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
  VALUES (v_uid, 'Legs', '2026-05-20 07:46:00+00', '2026-05-20 08:50:00+00')
  RETURNING id INTO ws4;

  -- reps: 8,10  setTimes: 66,62  restTimes: 234
  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws4, 'Single Leg Hip Thrusts', 58.5, 46.75, 810, 9, 128, '{}', '2026-05-20 07:46:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, set_time_sec, rest_time_sec, intensity_pct, use_for_1rm)
  VALUES (el,1,45,8,66,234,76.9,true),(el,2,45,10,62,NULL,76.9,true);

  -- reps: 10,8  setTimes: 39,34  restTimes: 75
  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws4, 'Hip Thrusts', 117, 93.5, 1620, 9, 73, '{}', '2026-05-20 08:04:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, set_time_sec, rest_time_sec, intensity_pct, use_for_1rm)
  VALUES (el,1,90,10,39,75,76.9,true),(el,2,90,8,34,NULL,76.9,true);

  -- reps: 8,8,8  setTimes: 45,51,89  restTimes: 239
  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws4, 'Romanian Deadlift', 69.75, 55.75, 1320, 8, 185, '{}', '2026-05-20 08:20:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, set_time_sec, rest_time_sec, intensity_pct, use_for_1rm)
  VALUES (el,1,55,8,45,239,78.9,true),(el,2,55,8,51,NULL,78.9,true),(el,3,55,8,89,NULL,78.9,true);

  -- reps: 8,8,8  setTimes: 40,198,50  restTimes: 275
  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws4, 'Front Barbell Squat', 69.75, 55.75, 1320, 8, 288, '{}', '2026-05-20 08:38:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, set_time_sec, rest_time_sec, intensity_pct, use_for_1rm)
  VALUES (el,1,55,8,40,275,78.9,true),(el,2,55,8,198,NULL,78.9,true),(el,3,55,8,50,NULL,78.9,true);

  -- reps: 8,8,8  setTimes: 2,1,2  restTimes: 6  (timer data looks glitchy but preserved as-is)
  INSERT INTO exercise_logs
    (workout_session_id, exercise_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
  VALUES (ws4, 'Calf Raises', 38, 30.5, 720, 8, 5, '{}', '2026-05-20 08:45:00+00')
  RETURNING id INTO el;
  INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, set_time_sec, rest_time_sec, intensity_pct, use_for_1rm)
  VALUES (el,1,30,8,2,6,78.9,true),(el,2,30,8,1,NULL,78.9,true),(el,3,30,8,2,NULL,78.9,true);

END $$;

SELECT 'done'
