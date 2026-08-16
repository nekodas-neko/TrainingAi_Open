-- 046_seed_powerbuilding_style_and_fix_phase.sql
-- Migration 038 used `created_at` which no longer exists on progression_styles,
-- so it silently failed and never created the 'Powerbuilding' style for users
-- whose account predates that column being added. This migration creates the
-- style for any user missing it, then fixes the null primary_style_id on the
-- Accumulation phase of 'Powerbuilding Progression'.

DO $$
DECLARE
  uid            uuid;
  powerblding_id uuid;
  ps_id          uuid;
BEGIN
  FOR uid IN SELECT id FROM users LOOP

    -- Create Powerbuilding style if missing
    SELECT id INTO powerblding_id
      FROM progression_styles
      WHERE user_id = uid AND name = 'Powerbuilding'
      LIMIT 1;

    IF powerblding_id IS NULL THEN
      powerblding_id := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name)
        VALUES (powerblding_id, uid, 'Powerbuilding');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), powerblding_id, 1, 80, 6, 120, true),
        (gen_random_uuid(), powerblding_id, 2, 80, 6, 120, true),
        (gen_random_uuid(), powerblding_id, 3, 80, 6, 120, true),
        (gen_random_uuid(), powerblding_id, 4, 80, 6, 120, true);
    END IF;

    -- Fix Accumulation phase in Powerbuilding Progression
    SELECT id INTO ps_id
      FROM phase_sets
      WHERE user_id = uid AND name = 'Powerbuilding Progression'
      LIMIT 1;
    IF ps_id IS NULL THEN CONTINUE; END IF;

    UPDATE program_phases
      SET primary_style_id = powerblding_id, secondary_style_id = powerblding_id
      WHERE phase_set_id = ps_id AND name = 'Accumulation';

  END LOOP;
END $$;
