-- 042_goal_phase_sets.sql
-- Adds 4 new progression styles and 4 goal-specific phase sets for all users.
-- Idempotent: all blocks guarded with IF NOT EXISTS.

DO $$
DECLARE
  uid            uuid;
  sid            uuid;
  hyp_plus_id    uuid;
  heavy_str_id   uuid;
  str_plus_id    uuid;
  max_str_id     uuid;
  testing_id     uuid;
  hypertrophy_id uuid;
  general_id     uuid;
  gen4_id        uuid;
  powerblding_id uuid;
  strength_id    uuid;
  str4_id        uuid;
  peak_id        uuid;
  deload_id      uuid;
  ps_id          uuid;
BEGIN
  FOR uid IN SELECT id FROM users LOOP

    -- ── New progression styles ───────────────────────────────────────────────

    IF NOT EXISTS (SELECT 1 FROM progression_styles WHERE user_id = uid AND name = 'Hypertrophy Plus') THEN
      sid := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name) VALUES (sid, uid, 'Hypertrophy Plus');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sid, 1, 70, 8, 75, false),
        (gen_random_uuid(), sid, 2, 70, 8, 75, false),
        (gen_random_uuid(), sid, 3, 70, 8, 75, false),
        (gen_random_uuid(), sid, 4, 70, 8, 75, false);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM progression_styles WHERE user_id = uid AND name = 'Heavy Strength') THEN
      sid := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name) VALUES (sid, uid, 'Heavy Strength');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sid, 1, 85, 5, 180, true),
        (gen_random_uuid(), sid, 2, 85, 5, 180, true),
        (gen_random_uuid(), sid, 3, 85, 5, 180, true),
        (gen_random_uuid(), sid, 4, 85, 5, 180, true),
        (gen_random_uuid(), sid, 5, 85, 5, 180, true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM progression_styles WHERE user_id = uid AND name = 'Strength Plus') THEN
      sid := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name) VALUES (sid, uid, 'Strength Plus');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sid, 1, 87, 3, 180, true),
        (gen_random_uuid(), sid, 2, 87, 3, 180, true),
        (gen_random_uuid(), sid, 3, 87, 3, 180, true),
        (gen_random_uuid(), sid, 4, 87, 3, 180, true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM progression_styles WHERE user_id = uid AND name = 'Max Strength') THEN
      sid := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name) VALUES (sid, uid, 'Max Strength');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sid, 1, 92, 3, 240, true),
        (gen_random_uuid(), sid, 2, 92, 3, 240, true),
        (gen_random_uuid(), sid, 3, 92, 3, 240, true);
    END IF;

    -- ── Resolve style IDs for this user ─────────────────────────────────────

    SELECT id INTO hyp_plus_id    FROM progression_styles WHERE user_id = uid AND name = 'Hypertrophy Plus'  LIMIT 1;
    SELECT id INTO heavy_str_id   FROM progression_styles WHERE user_id = uid AND name = 'Heavy Strength'    LIMIT 1;
    SELECT id INTO str_plus_id    FROM progression_styles WHERE user_id = uid AND name = 'Strength Plus'     LIMIT 1;
    SELECT id INTO max_str_id     FROM progression_styles WHERE user_id = uid AND name = 'Max Strength'      LIMIT 1;
    SELECT id INTO testing_id     FROM progression_styles WHERE user_id = uid AND name = 'Testing'           LIMIT 1;
    SELECT id INTO hypertrophy_id FROM progression_styles WHERE user_id = uid AND name = 'Hypertrophy'       LIMIT 1;
    SELECT id INTO general_id     FROM progression_styles WHERE user_id = uid AND name = 'General'           LIMIT 1;
    SELECT id INTO gen4_id        FROM progression_styles WHERE user_id = uid AND name = 'General 4-set'     LIMIT 1;
    SELECT id INTO powerblding_id FROM progression_styles WHERE user_id = uid AND name = 'Powerbuilding'     LIMIT 1;
    SELECT id INTO strength_id    FROM progression_styles WHERE user_id = uid AND name = 'Strength'          LIMIT 1;
    SELECT id INTO str4_id        FROM progression_styles WHERE user_id = uid AND name = 'Strength 4-set'    LIMIT 1;
    SELECT id INTO peak_id        FROM progression_styles WHERE user_id = uid AND name = 'Peak'              LIMIT 1;
    SELECT id INTO deload_id      FROM progression_styles WHERE user_id = uid AND name = 'Deload'            LIMIT 1;

    -- ── New phase sets ───────────────────────────────────────────────────────

    -- 1. Hypertrophy Progression
    IF NOT EXISTS (SELECT 1 FROM phase_sets WHERE user_id = uid AND name = 'Hypertrophy Progression') THEN
      ps_id := gen_random_uuid();
      INSERT INTO phase_sets (id, user_id, name, is_default, created_at) VALUES (ps_id, uid, 'Hypertrophy Progression', false, now());
      INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id) VALUES
        (gen_random_uuid(), ps_id, 0, 'Accumulation',    4, 'normal',    gen4_id,          gen4_id),
        (gen_random_uuid(), ps_id, 1, 'Intensification', 3, 'normal',    hypertrophy_id,   hypertrophy_id),
        (gen_random_uuid(), ps_id, 2, 'Peak',            2, 'normal',    hyp_plus_id,      hyp_plus_id),
        (gen_random_uuid(), ps_id, 3, 'Testing',         1, 'testing',   testing_id,       testing_id),
        (gen_random_uuid(), ps_id, 4, 'Deload',          1, 'deload',    deload_id,        NULL),
        (gen_random_uuid(), ps_id, 5, 'Accessory',       0, 'accessory', general_id,       NULL);
    END IF;

    -- 2. S+H Progression
    IF NOT EXISTS (SELECT 1 FROM phase_sets WHERE user_id = uid AND name = 'S+H Progression') THEN
      ps_id := gen_random_uuid();
      INSERT INTO phase_sets (id, user_id, name, is_default, created_at) VALUES (ps_id, uid, 'S+H Progression', false, now());
      INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id) VALUES
        (gen_random_uuid(), ps_id, 0, 'Accumulation',    4, 'normal',    hypertrophy_id,   hypertrophy_id),
        (gen_random_uuid(), ps_id, 1, 'Intensification', 3, 'normal',    hyp_plus_id,      hyp_plus_id),
        (gen_random_uuid(), ps_id, 2, 'Peak',            2, 'normal',    str4_id,          str4_id),
        (gen_random_uuid(), ps_id, 3, 'Testing',         1, 'testing',   testing_id,       testing_id),
        (gen_random_uuid(), ps_id, 4, 'Deload',          1, 'deload',    deload_id,        NULL),
        (gen_random_uuid(), ps_id, 5, 'Accessory',       0, 'accessory', general_id,       NULL);
    END IF;

    -- 3. Powerbuilding Progression
    IF NOT EXISTS (SELECT 1 FROM phase_sets WHERE user_id = uid AND name = 'Powerbuilding Progression') THEN
      ps_id := gen_random_uuid();
      INSERT INTO phase_sets (id, user_id, name, is_default, created_at) VALUES (ps_id, uid, 'Powerbuilding Progression', false, now());
      INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id) VALUES
        (gen_random_uuid(), ps_id, 0, 'Accumulation',    4, 'normal',    powerblding_id,   powerblding_id),
        (gen_random_uuid(), ps_id, 1, 'Intensification', 3, 'normal',    heavy_str_id,     heavy_str_id),
        (gen_random_uuid(), ps_id, 2, 'Peak',            2, 'peak',      peak_id,          NULL),
        (gen_random_uuid(), ps_id, 3, 'Testing',         1, 'testing',   testing_id,       testing_id),
        (gen_random_uuid(), ps_id, 4, 'Deload',          1, 'deload',    deload_id,        NULL),
        (gen_random_uuid(), ps_id, 5, 'Accessory',       0, 'accessory', general_id,       NULL);
    END IF;

    -- 4. Strength Progression
    IF NOT EXISTS (SELECT 1 FROM phase_sets WHERE user_id = uid AND name = 'Strength Progression') THEN
      ps_id := gen_random_uuid();
      INSERT INTO phase_sets (id, user_id, name, is_default, created_at) VALUES (ps_id, uid, 'Strength Progression', false, now());
      INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id) VALUES
        (gen_random_uuid(), ps_id, 0, 'Accumulation',    5, 'normal',    strength_id,      strength_id),
        (gen_random_uuid(), ps_id, 1, 'Intensification', 3, 'normal',    str_plus_id,      str_plus_id),
        (gen_random_uuid(), ps_id, 2, 'Peak',            2, 'peak',      max_str_id,       NULL),
        (gen_random_uuid(), ps_id, 3, 'Testing',         1, 'testing',   testing_id,       testing_id),
        (gen_random_uuid(), ps_id, 4, 'Deload',          1, 'deload',    deload_id,        NULL),
        (gen_random_uuid(), ps_id, 5, 'Accessory',       0, 'accessory', general_id,       NULL);
    END IF;

  END LOOP;
END $$;
