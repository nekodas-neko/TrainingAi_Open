-- Seed data for the local dev/test database.
-- Creates a fake user with a full program, schedule, progression style,
-- ~2 weeks of workout history, body metrics, sleep, mood and PR data.
-- Only runs against an empty DB (setup.sh only calls this on first run).

DO $$
DECLARE
  uid          uuid;
  style_id     uuid;
  program_id   uuid;
  sess_push    uuid;
  sess_pull    uuid;
  sess_legs    uuid;
  ws           uuid;
  el           uuid;
  d            int;
  -- Every seeded date is relative to the SEEDED USER'S today, not the database server's.
  --
  -- `current_date` is the Postgres server's date, which is UTC in CI. The app reads "today" in the
  -- user's timezone, and this user is in Australia/Brisbane (UTC+10) — so from 14:00 UTC onward the
  -- two disagree by a day and the newest row seeded here is *yesterday* as far as the app is
  -- concerned. That is the same UTC-date bug CLAUDE.md bans in application code, in SQL form, and it
  -- made `e2e/goal-invalidation.spec.ts` fail for ten hours of every day: its assertion needs today
  -- to carry a steps value, and `goals-progress-card.tsx` drops rows whose value is null.
  --
  -- Declared once and used everywhere below, so body metrics, sleep and mood cannot drift a day
  -- apart from each other either.
  today        date := (now() AT TIME ZONE 'Australia/Brisbane')::date;
BEGIN
  -- ── User ────────────────────────────────────────────────────────────────
  -- password is "testpass123"
  INSERT INTO users (email, name, display_name, is_active, timezone, sex, height_cm, weight_goal_kg, password_hash)
  VALUES ('test@local.dev', 'Test User', 'Test User', true, 'Australia/Brisbane', 'male', 180, 80, '$2b$10$ccKSMzFRkJGPfCkKKOhCGuv8c8kbYJnUbszPj55iS3VGyG0ih.KmS')
  RETURNING id INTO uid;

  -- ── Progression style ──────────────────────────────────────────────────
  INSERT INTO progression_styles (user_id, name) VALUES (uid, 'Standard') RETURNING id INTO style_id;
  INSERT INTO style_sets (style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
    (style_id, 1, 75, 8, 90, true),
    (style_id, 2, 75, 8, 90, true),
    (style_id, 3, 75, 8, 90, false);

  -- ── Program ────────────────────────────────────────────────────────────
  INSERT INTO programs (user_id, name, is_active, phase_mode, started_at, sessions_per_cycle)
  VALUES (uid, 'Push Pull Legs', true, 'manual', today - interval '60 days', 3)
  RETURNING id INTO program_id;

  INSERT INTO program_sessions (program_id, name, position, icon) VALUES (program_id, 'Push', 0, 'Dumbbell') RETURNING id INTO sess_push;
  INSERT INTO program_sessions (program_id, name, position, icon) VALUES (program_id, 'Pull', 1, 'Dumbbell') RETURNING id INTO sess_pull;
  INSERT INTO program_sessions (program_id, name, position, icon) VALUES (program_id, 'Legs', 2, 'Dumbbell') RETURNING id INTO sess_legs;

  INSERT INTO session_exercises (session_id, exercise_name, style_id, muscle_groups, position, exercise_role) VALUES
    (sess_push, 'Bench Press',     style_id, '{chest}',    0, 'primary'),
    (sess_push, 'Overhead Press',  style_id, '{shoulders}',1, 'primary'),
    (sess_push, 'Tricep Pushdown', style_id, '{triceps}',  2, 'accessory'),
    (sess_pull, 'Deadlift',        style_id, '{back}',     0, 'primary'),
    (sess_pull, 'Lat Pulldown',    style_id, '{back}',     1, 'primary'),
    (sess_pull, 'Bicep Curl',      style_id, '{biceps}',   2, 'accessory'),
    (sess_legs, 'Front Barbell Squat', style_id, '{quads}',   0, 'primary'),
    (sess_legs, 'Romanian Deadlift',   style_id, '{hamstrings}',1, 'primary'),
    (sess_legs, 'Calf Raises',         style_id, '{calves}', 2, 'accessory');

  -- ── Schedule (rotation: Push, Pull, Legs, then 1 rest day) ────────────────
  INSERT INTO schedules (program_id, type, rest_after_n) VALUES (program_id, 'rotation', 3);

  -- ── Workout history: alternate Push/Pull/Legs over the last 9 sessions ──
  FOR d IN 0..8 LOOP
    DECLARE
      sess_id   uuid;
      sess_name text;
      started   timestamptz := today - ((9 - d) * 2 || ' days')::interval + interval '18 hours';
    BEGIN
      CASE d % 3
        WHEN 0 THEN sess_id := sess_push; sess_name := 'Push';
        WHEN 1 THEN sess_id := sess_pull; sess_name := 'Pull';
        ELSE        sess_id := sess_legs; sess_name := 'Legs';
      END CASE;

      INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at)
      VALUES (uid, sess_id, sess_name, started, started + interval '55 minutes')
      RETURNING id INTO ws;

      INSERT INTO exercise_logs
        (workout_session_id, exercise_name, style_id, style_name, estimated_1rm, target_80, volume, avg_reps, time_to_complete, muscle_groups, logged_at)
      VALUES (ws, 'Bench Press', style_id, 'Standard', 90 + d, 72 + d, 1440, 8, 180, '{chest}', started)
      RETURNING id INTO el;
      INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, intensity_pct, use_for_1rm) VALUES
        (el, 1, 60 + d, 8, 75, true),
        (el, 2, 60 + d, 8, 75, true),
        (el, 3, 60 + d, 7, 75, false);
    END;
  END LOOP;

  -- ── Body metrics: last 14 days ────────────────────────────────────────
  FOR d IN 0..13 LOOP
    INSERT INTO body_metrics (user_id, date, weight_kg, body_fat_pct, calories, protein_g, carbs_g, fat_g, steps, resting_heart_rate, hrv_ms, spo2_pct, water_ml)
    VALUES (uid, today - d, 82.5 - d * 0.05, 18 - d * 0.05, 2400, 180, 250, 80, 8000 + d * 100, 58, 65, 97, 2500);
  END LOOP;

  -- ── Sleep: last 7 nights ───────────────────────────────────────────────
  FOR d IN 1..7 LOOP
    INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, deep_sleep_hours, rem_sleep_hours, light_sleep_hours, awake_hours)
    VALUES (
      uid, today - d + 1,
      (today - d) + interval '23 hours',
      (today - d + 1) + interval '7 hours',
      8, 1.5, 1.8, 4.2, 0.5
    );
  END LOOP;

  -- ── Mood check-ins: last 7 days ────────────────────────────────────────
  FOR d IN 0..6 LOOP
    INSERT INTO mood_logs (user_id, log_date, energy_level, sleep_quality, body_state, sore_muscles)
    VALUES (uid, today - d, 'good', 'good', '{feeling_good}', '{}');
  END LOOP;

  -- ── Personal records ──────────────────────────────────────────────────
  INSERT INTO personal_records (user_id, exercise_name, estimated_1rm, achieved_at) VALUES
    (uid, 'Bench Press', 98, now() - interval '2 days'),
    (uid, 'Front Barbell Squat', 130, now() - interval '5 days'),
    (uid, 'Deadlift', 160, now() - interval '3 days');

END $$;
