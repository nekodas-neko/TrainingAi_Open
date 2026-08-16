-- 047_fix_goal_phase_set_styles.sql
-- Migration 042 resolved style IDs at run time. If a style didn't exist yet
-- (e.g. the migration ran before the user first logged in, or a previous
-- migration silently failed to create it), primary_style_id ends up NULL for
-- that phase and the builder shows "N cycles" with no sets/reps info.
--
-- This migration re-resolves ALL phase → style links for the four goal phase
-- sets unconditionally (safe: sets correct ID even if already correct).

DO $$
DECLARE
  uid             uuid;

  -- style IDs for this user
  hypertrophy_id  uuid;
  hyp_plus_id     uuid;
  gen4_id         uuid;
  strength_id     uuid;
  str4_id         uuid;
  str_plus_id     uuid;
  heavy_str_id    uuid;
  max_str_id      uuid;
  peak_id         uuid;
  general_id      uuid;
  testing_id      uuid;
  deload_id       uuid;
  powerblding_id  uuid;

  ps_id           uuid;
BEGIN
  FOR uid IN SELECT id FROM users LOOP

    -- Resolve all style IDs for this user
    SELECT id INTO hypertrophy_id FROM progression_styles WHERE user_id = uid AND name = 'Hypertrophy'      LIMIT 1;
    SELECT id INTO hyp_plus_id    FROM progression_styles WHERE user_id = uid AND name = 'Hypertrophy Plus' LIMIT 1;
    SELECT id INTO gen4_id        FROM progression_styles WHERE user_id = uid AND name = 'General 4-set'    LIMIT 1;
    SELECT id INTO strength_id    FROM progression_styles WHERE user_id = uid AND name = 'Strength'         LIMIT 1;
    SELECT id INTO str4_id        FROM progression_styles WHERE user_id = uid AND name = 'Strength 4-set'   LIMIT 1;
    SELECT id INTO str_plus_id    FROM progression_styles WHERE user_id = uid AND name = 'Strength Plus'    LIMIT 1;
    SELECT id INTO heavy_str_id   FROM progression_styles WHERE user_id = uid AND name = 'Heavy Strength'   LIMIT 1;
    SELECT id INTO max_str_id     FROM progression_styles WHERE user_id = uid AND name = 'Max Strength'     LIMIT 1;
    SELECT id INTO peak_id        FROM progression_styles WHERE user_id = uid AND name = 'Peak'             LIMIT 1;
    SELECT id INTO general_id     FROM progression_styles WHERE user_id = uid AND name = 'General'          LIMIT 1;
    SELECT id INTO testing_id     FROM progression_styles WHERE user_id = uid AND name = 'Testing'          LIMIT 1;
    SELECT id INTO deload_id      FROM progression_styles WHERE user_id = uid AND name = 'Deload'           LIMIT 1;
    SELECT id INTO powerblding_id FROM progression_styles WHERE user_id = uid AND name = 'Powerbuilding'    LIMIT 1;

    -- 1. Hypertrophy Progression
    SELECT id INTO ps_id FROM phase_sets WHERE user_id = uid AND name = 'Hypertrophy Progression' LIMIT 1;
    IF ps_id IS NOT NULL THEN
      UPDATE program_phases SET primary_style_id = gen4_id,        secondary_style_id = gen4_id        WHERE phase_set_id = ps_id AND name = 'Accumulation';
      UPDATE program_phases SET primary_style_id = hypertrophy_id, secondary_style_id = hypertrophy_id WHERE phase_set_id = ps_id AND name = 'Intensification';
      UPDATE program_phases SET primary_style_id = hyp_plus_id,    secondary_style_id = hyp_plus_id    WHERE phase_set_id = ps_id AND name = 'Peak';
      UPDATE program_phases SET primary_style_id = testing_id,     secondary_style_id = testing_id     WHERE phase_set_id = ps_id AND name = 'Testing';
      UPDATE program_phases SET primary_style_id = deload_id,      secondary_style_id = NULL            WHERE phase_set_id = ps_id AND name = 'Deload';
      UPDATE program_phases SET primary_style_id = general_id,     secondary_style_id = NULL            WHERE phase_set_id = ps_id AND name = 'Accessory';
    END IF;

    -- 2. S+H Progression
    SELECT id INTO ps_id FROM phase_sets WHERE user_id = uid AND name = 'S+H Progression' LIMIT 1;
    IF ps_id IS NOT NULL THEN
      UPDATE program_phases SET primary_style_id = hypertrophy_id, secondary_style_id = hypertrophy_id WHERE phase_set_id = ps_id AND name = 'Accumulation';
      UPDATE program_phases SET primary_style_id = hyp_plus_id,    secondary_style_id = hyp_plus_id    WHERE phase_set_id = ps_id AND name = 'Intensification';
      UPDATE program_phases SET primary_style_id = str4_id,        secondary_style_id = str4_id        WHERE phase_set_id = ps_id AND name = 'Peak';
      UPDATE program_phases SET primary_style_id = testing_id,     secondary_style_id = testing_id     WHERE phase_set_id = ps_id AND name = 'Testing';
      UPDATE program_phases SET primary_style_id = deload_id,      secondary_style_id = NULL            WHERE phase_set_id = ps_id AND name = 'Deload';
      UPDATE program_phases SET primary_style_id = general_id,     secondary_style_id = NULL            WHERE phase_set_id = ps_id AND name = 'Accessory';
    END IF;

    -- 3. Powerbuilding Progression
    SELECT id INTO ps_id FROM phase_sets WHERE user_id = uid AND name = 'Powerbuilding Progression' LIMIT 1;
    IF ps_id IS NOT NULL THEN
      UPDATE program_phases SET primary_style_id = powerblding_id, secondary_style_id = powerblding_id WHERE phase_set_id = ps_id AND name = 'Accumulation';
      UPDATE program_phases SET primary_style_id = heavy_str_id,   secondary_style_id = heavy_str_id   WHERE phase_set_id = ps_id AND name = 'Intensification';
      UPDATE program_phases SET primary_style_id = peak_id,        secondary_style_id = NULL            WHERE phase_set_id = ps_id AND name = 'Peak';
      UPDATE program_phases SET primary_style_id = testing_id,     secondary_style_id = testing_id     WHERE phase_set_id = ps_id AND name = 'Testing';
      UPDATE program_phases SET primary_style_id = deload_id,      secondary_style_id = NULL            WHERE phase_set_id = ps_id AND name = 'Deload';
      UPDATE program_phases SET primary_style_id = general_id,     secondary_style_id = NULL            WHERE phase_set_id = ps_id AND name = 'Accessory';
    END IF;

    -- 4. Strength Progression
    SELECT id INTO ps_id FROM phase_sets WHERE user_id = uid AND name = 'Strength Progression' LIMIT 1;
    IF ps_id IS NOT NULL THEN
      UPDATE program_phases SET primary_style_id = strength_id,    secondary_style_id = strength_id    WHERE phase_set_id = ps_id AND name = 'Accumulation';
      UPDATE program_phases SET primary_style_id = str_plus_id,    secondary_style_id = str_plus_id    WHERE phase_set_id = ps_id AND name = 'Intensification';
      UPDATE program_phases SET primary_style_id = max_str_id,     secondary_style_id = NULL            WHERE phase_set_id = ps_id AND name = 'Peak';
      UPDATE program_phases SET primary_style_id = testing_id,     secondary_style_id = testing_id     WHERE phase_set_id = ps_id AND name = 'Testing';
      UPDATE program_phases SET primary_style_id = deload_id,      secondary_style_id = NULL            WHERE phase_set_id = ps_id AND name = 'Deload';
      UPDATE program_phases SET primary_style_id = general_id,     secondary_style_id = NULL            WHERE phase_set_id = ps_id AND name = 'Accessory';
    END IF;

  END LOOP;
END $$;
