-- Dev-only data for the browser preview's screen captures (#3761, mobile/scripts/web-screens.mjs).
-- Made-up numbers for the seeded user test@local.dev, added on top of seed.sql:
--   food (meal types, a few foods, five days of logs, targets), four more weeks of body metrics
--   and sleep before seed.sql's window, a week of readiness verdicts, and the admin flag so the
--   Admin Console screen opens.
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
