-- Dev-only data for the browser preview's screen captures (#3761, mobile/scripts/web-screens.mjs).
-- Made-up numbers for the seeded user test@local.dev, added on top of seed.sql:
--   food (meal types, a few foods, five days of logs, targets), four more weeks of body metrics
--   and sleep before seed.sql's window, a week of readiness verdicts, and the admin flag so the
--   Admin Console screen opens. The second block (#3969) adds the states a capture could not reach:
--   workouts in this Monday-start week and last, a personal record, a weight goal, an injury,
--   supplements, a friend code and one friend, cardio activities with heart rate, a Body Battery
--   morning level with no readings, and an unusual-day readiness verdict.
-- seed.sql's own rows are never changed (tests read them); the one exception is users.is_admin,
-- which nothing in seed.sql sets. Safe to run again: every insert skips what is already there.
-- Local dev database only. Never run it against production.

DO $$
DECLARE
  uid      uuid;
  today    date := (now() AT TIME ZONE 'Australia/Brisbane')::date;
  breakfast uuid;
  lunch    uuid;
  dinner   uuid;
  snack    uuid;
  oats     uuid;
  eggs     uuid;
  chicken  uuid;
  rice     uuid;
  salmon   uuid;
  yoghurt  uuid;
  banana   uuid;
  d        int;
BEGIN
  SELECT id INTO uid FROM users WHERE email = 'test@local.dev';
  IF uid IS NULL THEN
    RAISE NOTICE 'seed-preview-screens: test@local.dev is missing; run pnpm db:local first';
    RETURN;
  END IF;

  UPDATE users SET is_admin = true WHERE id = uid AND is_admin IS DISTINCT FROM true;

  -- ── Nutrition targets ─────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM nutrition_targets WHERE user_id = uid) THEN
    INSERT INTO nutrition_targets (user_id, calories, protein_g, carbs_g, fat_g, fiber_g)
    VALUES (uid, 2500, 180, 270, 80, 30);
  END IF;

  -- ── Meal types ────────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM meal_types WHERE user_id = uid AND deleted_at IS NULL) THEN
    INSERT INTO meal_types (user_id, name, emoji, sort_order, time_start_hour, time_end_hour) VALUES
      (uid, 'Breakfast', '🍳', 0, 5, 10),
      (uid, 'Lunch',     '🥗', 1, 11, 14),
      (uid, 'Dinner',    '🍽️', 2, 17, 21),
      (uid, 'Snack',     '🍎', 3, 0, 24);
  END IF;
  SELECT id INTO breakfast FROM meal_types WHERE user_id = uid AND deleted_at IS NULL ORDER BY sort_order LIMIT 1;
  SELECT id INTO lunch     FROM meal_types WHERE user_id = uid AND deleted_at IS NULL ORDER BY sort_order OFFSET 1 LIMIT 1;
  SELECT id INTO dinner    FROM meal_types WHERE user_id = uid AND deleted_at IS NULL ORDER BY sort_order OFFSET 2 LIMIT 1;
  SELECT id INTO snack     FROM meal_types WHERE user_id = uid AND deleted_at IS NULL ORDER BY sort_order OFFSET 3 LIMIT 1;
  lunch  := coalesce(lunch, breakfast);
  dinner := coalesce(dinner, lunch);
  snack  := coalesce(snack, dinner);

  -- ── Foods and five days of logs ───────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM food_logs WHERE user_id = uid) THEN
    INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, fiber_g, source)
      VALUES (uid, 'Rolled oats with milk', 250, 380, 16, 58, 9, 7, 'manual') RETURNING id INTO oats;
    INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
      VALUES (uid, 'Scrambled eggs (3)', 150, 270, 20, 2, 20, 'manual') RETURNING id INTO eggs;
    INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
      VALUES (uid, 'Grilled chicken breast', 200, 330, 62, 0, 7, 'manual') RETURNING id INTO chicken;
    INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, fiber_g, source)
      VALUES (uid, 'Steamed rice', 200, 260, 5, 57, 1, 1, 'manual') RETURNING id INTO rice;
    INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
      VALUES (uid, 'Baked salmon', 180, 370, 40, 0, 23, 'manual') RETURNING id INTO salmon;
    INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
      VALUES (uid, 'Greek yoghurt', 200, 190, 20, 9, 8, 'manual') RETURNING id INTO yoghurt;
    INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, fiber_g, source)
      VALUES (uid, 'Banana', 120, 105, 1, 27, 0, 3, 'manual') RETURNING id INTO banana;

    -- Today has breakfast and lunch only, so the day reads as in progress.
    FOR d IN 0..4 LOOP
      INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, quantity_multiplier, logged_at) VALUES
        (uid, (today - d)::text, breakfast, CASE WHEN d % 2 = 0 THEN oats ELSE eggs END, 1,
         (today - d) + interval '7 hours'),
        (uid, (today - d)::text, lunch, chicken, 1, (today - d) + interval '12 hours 30 minutes'),
        (uid, (today - d)::text, lunch, rice, 1 + (d % 2) * 0.5, (today - d) + interval '12 hours 31 minutes');
      IF d > 0 THEN
        INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, quantity_multiplier, logged_at) VALUES
          (uid, (today - d)::text, dinner, salmon, 1, (today - d) + interval '19 hours'),
          (uid, (today - d)::text, dinner, rice, 1, (today - d) + interval '19 hours 1 minute'),
          (uid, (today - d)::text, snack, CASE WHEN d % 2 = 0 THEN yoghurt ELSE banana END, 1,
           (today - d) + interval '15 hours 30 minutes');
      END IF;
    END LOOP;
  END IF;

  -- ── Four more weeks of body metrics before seed.sql's 14 days ──────────
  -- Varied, so baselines and trends have something to draw.
  FOR d IN 14..41 LOOP
    IF NOT EXISTS (SELECT 1 FROM body_metrics WHERE user_id = uid AND date = today - d) THEN
      INSERT INTO body_metrics (user_id, date, weight_kg, body_fat_pct, calories, protein_g, carbs_g, fat_g, steps, resting_heart_rate, hrv_ms, spo2_pct, water_ml)
      VALUES (uid, today - d, 83.4 - (41 - d) * 0.03, 18.8 - (41 - d) * 0.02, 2350 + (d % 4) * 60, 170 + (d % 3) * 5,
              240 + (d % 5) * 10, 78, 7200 + (d % 6) * 650, 57 + (d % 4), 60 + (d % 7) * 2, 97, 2300 + (d % 3) * 200);
    END IF;
  END LOOP;

  -- ── Four more weeks of sleep before seed.sql's 7 nights ───────────────
  FOR d IN 8..35 LOOP
    IF NOT EXISTS (SELECT 1 FROM sleep_sessions WHERE user_id = uid AND date = today - d + 1) THEN
      INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, deep_sleep_hours, rem_sleep_hours, light_sleep_hours, awake_hours)
      VALUES (
        uid, today - d + 1,
        (today - d) + interval '22 hours 45 minutes' + ((d % 4) * interval '15 minutes'),
        (today - d + 1) + interval '6 hours 40 minutes' + ((d % 3) * interval '10 minutes'),
        7.2 + (d % 5) * 0.2, 1.3 + (d % 3) * 0.1, 1.6 + (d % 4) * 0.1, 3.9 + (d % 2) * 0.3, 0.4
      );
    END IF;
  END LOOP;

  -- ── Readiness verdicts: the last seven days ───────────────────────────
  FOR d IN 0..6 LOOP
    INSERT INTO readiness_verdicts
      (user_id, date, verdict, score, band_median, band_low, band_high, baseline_days,
       baseline_same_version_days, contributors, readiness_model_version, model_version)
    VALUES (
      uid, today - d,
      CASE WHEN d = 2 THEN 'poor' WHEN d % 3 = 0 THEN 'good' ELSE 'normal' END,
      CASE WHEN d = 2 THEN 48 WHEN d % 3 = 0 THEN 78 ELSE 64 END,
      63, 57, 69.5, 28, 7,
      jsonb_build_object(
        'hrvBalance', jsonb_build_object('score', 60 + d * 3, 'provisional', false, 'input', 0.2, 'gap', null),
        'recoveryIndex', jsonb_build_object('score', 72, 'provisional', false, 'input', 4, 'gap', null)
      ),
      'preview-seed', 1
    )
    ON CONFLICT (user_id, date) DO NOTHING;
  END LOOP;
END $$;

-- ── #3969: the states the first block could not reach ───────────────────────────────────────────
-- Every date is the seeded user's local day (Australia/Brisbane), counted from the day this runs;
-- clock times are local midday or earlier, never ahead of now. Made-up numbers only.
DO $$
DECLARE
  uid        uuid;
  fid        uuid;
  tz         text := 'Australia/Brisbane';
  today      date := (now() AT TIME ZONE 'Australia/Brisbane')::date;
  week_start date := ((now() AT TIME ZONE 'Australia/Brisbane')::date
                      - (extract(isodow FROM (now() AT TIME ZONE 'Australia/Brisbane')::date)::int - 1));
  plan       record;
  ex         jsonb;
  day        date;
  started    timestamptz;
  ws         uuid;
  el         uuid;
  w          numeric;
  total      numeric;
  reps       int[] := ARRAY[8, 8, 7, 6];
  n          int;
BEGIN
  SELECT id INTO uid FROM users WHERE email = 'test@local.dev';
  IF uid IS NULL THEN
    RETURN;
  END IF;

  -- ── Workouts: Mon and Tue of this week (only days already begun), Mon, Wed and Fri of last ─────
  -- Last week runs 5% lighter, so "vs last week" has a rise to show.
  FOR plan IN
    SELECT * FROM jsonb_to_recordset('[
      {"off": -7, "name": "Push", "k": 0.95, "ex": [["Bench Press","chest",80],["Overhead Press","shoulders",50],["Tricep Pushdown","triceps",30]]},
      {"off": -5, "name": "Pull", "k": 0.95, "ex": [["Deadlift","back",110],["Lat Pulldown","back",65],["Bicep Curl","biceps",22]]},
      {"off": -3, "name": "Legs", "k": 0.95, "ex": [["Front Barbell Squat","quads",90],["Romanian Deadlift","hamstrings",85],["Calf Raises","calves",70]]},
      {"off": 0,  "name": "Push", "k": 1.0,  "ex": [["Bench Press","chest",80],["Overhead Press","shoulders",50],["Tricep Pushdown","triceps",30]]},
      {"off": 1,  "name": "Pull", "k": 1.0,  "ex": [["Deadlift","back",110],["Lat Pulldown","back",65],["Bicep Curl","biceps",22]]}
    ]'::jsonb) AS x(off int, name text, k numeric, ex jsonb)
  LOOP
    day := week_start + plan.off;
    CONTINUE WHEN day > today;
    -- A day that already has a workout (seed.sql's every-other-day history) is left as it is.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM workout_sessions
      WHERE user_id = uid AND deleted_at IS NULL
        AND (started_at AT TIME ZONE tz)::date = day
    );
    started := LEAST(((day + interval '12 hours') AT TIME ZONE tz), now() - interval '2 hours');
    INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
    VALUES (uid, plan.name, started, started + interval '55 minutes')
    RETURNING id INTO ws;
    n := 0;
    FOR ex IN SELECT * FROM jsonb_array_elements(plan.ex) LOOP
      w := round((ex->>2)::numeric * plan.k / 2.5) * 2.5;
      total := 0;
      FOR n IN 1..4 LOOP
        total := total + w * reps[n];
      END LOOP;
      INSERT INTO exercise_logs
        (workout_session_id, exercise_name, style_name, estimated_1rm, target_80, volume, avg_reps,
         time_to_complete, muscle_groups, logged_at)
      VALUES (ws, ex->>0, 'Standard', round(w * (1 + 8.0 / 30)), round(w * 0.8), total, 7.25, 600,
              ARRAY[ex->>1], started)
      RETURNING id INTO el;
      FOR n IN 1..4 LOOP
        INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, intensity_pct, use_for_1rm)
        VALUES (el, n, w, reps[n], 75, n <= 2);
      END LOOP;
    END LOOP;
  END LOOP;

  -- ── A personal record in the current week ─────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM personal_records WHERE user_id = uid AND exercise_name = 'Overhead Press') THEN
    INSERT INTO personal_records (user_id, exercise_name, estimated_1rm, achieved_at)
    VALUES (uid, 'Overhead Press', 68,
            LEAST(((week_start + interval '12 hours') AT TIME ZONE tz), now() - interval '2 hours'));
  END IF;

  -- ── A weight goal (the API's weightGoalKg is this column) ─────────────────────────────────────
  UPDATE users SET target_weight_kg = 79.5 WHERE id = uid AND target_weight_kg IS NULL;

  -- ── One active injury ─────────────────────────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM injuries WHERE user_id = uid AND deleted_at IS NULL AND resolved_date IS NULL) THEN
    INSERT INTO injuries (user_id, muscle_name, notes, severity, started_date)
    VALUES (uid, 'shoulders', 'Tight after overhead work', 'mild', today - 6);
  END IF;

  -- ── Supplements ───────────────────────────────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM supplements WHERE user_id = uid AND deleted_at IS NULL) THEN
    INSERT INTO supplements (user_id, name, dose, sort_order, active, default_amount, unit, started_on)
    VALUES (uid, 'Creatine', '5 g', 0, true, 5, 'g', today - 60),
           (uid, 'Vitamin D', '1000 IU', 1, true, 1000, 'IU', today - 90);
  END IF;

  -- ── A friend code and one friend (a made-up second account) ───────────────────────────────────
  UPDATE users SET friend_code = 'PREVIEW1' WHERE id = uid AND friend_code IS NULL;
  SELECT id INTO fid FROM users WHERE email = 'friend@local.dev';
  IF fid IS NULL THEN
    INSERT INTO users (email, name, display_name, friend_code)
    VALUES ('friend@local.dev', 'Sample Friend', 'Sample Friend', 'FRIEND01')
    RETURNING id INTO fid;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM friendships
    WHERE (requester_id = uid AND addressee_id = fid) OR (requester_id = fid AND addressee_id = uid)
  ) THEN
    INSERT INTO friendships (requester_id, addressee_id, status) VALUES (fid, uid, 'accepted');
  END IF;

  -- ── Cardio Hub: a few activities with heart rate over the last two weeks ──────────────────────
  FOR plan IN
    SELECT * FROM (VALUES
      (1,  'run',   'Easy run',      42.0,  7.4, 148, 167, 520.0, 410),
      (3,  'cycle', 'Evening ride',  65.0, 24.0, 135, 158, 150.0, 520),
      (5,  'run',   'Tempo run',     38.0,  7.8, 161, 179, 292.0, 455),
      (8,  'walk',  'Lunch walk',    35.0,  3.1, 104, 121, 677.0, 190),
      (10, 'run',   'Long run',      71.0, 12.1, 152, 171, 352.0, 780),
      (12, 'cycle', 'Weekend ride',  95.0, 34.0, 139, 163, 168.0, 760)
    ) AS a(back, kind, title, minutes, km, avg_hr, max_hr, pace, kcal)
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM activity_logs
      WHERE user_id = uid AND date = today - plan.back AND activity_type = plan.kind
        AND title = plan.title AND deleted_at IS NULL
    );
    INSERT INTO activity_logs
      (user_id, date, activity_type, title, start_time, end_time, duration_min, distance_km,
       calories_burned, avg_hr, max_hr, avg_pace_sec_per_km)
    VALUES (uid, today - plan.back, plan.kind, plan.title, time '12:00',
            time '12:00' + (plan.minutes * interval '1 minute'), plan.minutes, plan.km,
            plan.kcal, plan.avg_hr, plan.max_hr, plan.pace);
    -- The hub's zone minutes and trends are counted from heart-rate samples, not from the activity
    -- row: one a minute across the activity, rising to its peak in the last quarter. Past days only,
    -- so today stays without readings (the Body Battery state below).
    INSERT INTO oura_heartrate (user_id, timestamp, bpm, source)
    SELECT uid,
           (((today - plan.back) + time '12:00') AT TIME ZONE tz) + (m * interval '1 minute'),
           round(plan.avg_hr + (plan.max_hr - plan.avg_hr) * (m::numeric / plan.minutes - 0.5) * 1.5)::int,
           'oura_ble'
    FROM generate_series(0, floor(plan.minutes)::int - 1) AS m
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- ── Walking plan (#3779): the Cardio Hub's walking week ───────────────────────────────────────
  -- A walking plan is only a plan row (its targets are set from history on the first read, and its
  -- state lives in the snapshot). Added only when the user has no active plan. This week's steps are
  -- made-up, set for Monday to today so the week shows done, part-way and empty days.
  IF NOT EXISTS (SELECT 1 FROM running_plans WHERE user_id = uid AND is_active) THEN
    INSERT INTO running_plans (user_id, goal_kind, framework_key, fitness_snapshot, is_active, created_at)
    VALUES (uid, 'walking', 'walking-heart-health', '{}'::jsonb, true, now() - interval '6 days');
  END IF;
  UPDATE body_metrics
     SET steps = CASE (date - date_trunc('week', today::timestamp)::date)
                   WHEN 0 THEN 9100 WHEN 1 THEN 8400 WHEN 2 THEN 3200 WHEN 3 THEN 0
                   WHEN 4 THEN 7800 WHEN 5 THEN 8800 ELSE 6240 END
   WHERE user_id = uid
     AND date >= date_trunc('week', today::timestamp)::date AND date < today;
  IF NOT EXISTS (SELECT 1 FROM body_metrics WHERE user_id = uid AND date = today) THEN
    INSERT INTO body_metrics (user_id, date, steps) VALUES (uid, today, 6240);
  ELSE
    UPDATE body_metrics SET steps = 6240 WHERE user_id = uid AND date = today;
  END IF;

  -- ── Body Battery: today's morning level, with no heart-rate readings yet ──────────────────────
  -- Energy's "Waiting for the ring's heart rate" state needs a readiness-sourced anchor. A read of
  -- /api/body-battery before this runs stores the fallback (50, 'default'), which hides it; only
  -- that fallback is replaced, never a real anchor. oura_heartrate is left empty for today.
  INSERT INTO body_battery_daily
    (user_id, date, anchor, anchor_source, end_value, day_min, day_max, total_charged, total_drained,
     resting_hr, hr_max, hr_sample_count, model_version)
  VALUES (uid, today, 76, 'readiness', 76, 76, 76, 0, 0, 58, 185, 0, 'preview-seed')
  ON CONFLICT (user_id, date) DO UPDATE
    SET anchor = 76, anchor_source = 'readiness', end_value = 76, day_min = 76, day_max = 76,
        total_charged = 0, total_drained = 0, hr_sample_count = 0, updated_at = now()
    WHERE body_battery_daily.anchor_source = 'default';

  -- ── An unusual-day readiness verdict for today, still unanswered (Home's unusual-day card) ────
  UPDATE readiness_verdicts
     SET verdict = 'good', score = 78, band_median = 63, band_low = 57, band_high = 69.5
   WHERE user_id = uid AND date = today AND response_state = 'none' AND verdict = 'normal';
END $$;
