-- 025_backfill_all_standard_phases.sql
-- Comprehensive backfill: ensures all 6 standard phases exist in every
-- Default phase set. Previous migrations only added Testing/Deload/Accessory;
-- the original normal/peak phases may have been lost if updatePhaseSet was
-- called with a stale cache before the editor fix landed.
-- Detection is by phase_type (not name) so renamed phases are not duplicated.
-- 'normal' is checked twice (Accumulation + Intensification) by counting
-- existing normal phases and adding whichever are missing.

DO $$
DECLARE
  u          RECORD;
  set_id     UUID;
  max_pos    INTEGER;
  sty_id     UUID;
  normal_cnt INTEGER;
BEGIN
  FOR u IN SELECT id FROM users LOOP
    SELECT id INTO set_id FROM phase_sets WHERE user_id = u.id AND is_default = true LIMIT 1;
    IF set_id IS NULL THEN CONTINUE; END IF;

    SELECT COUNT(*) INTO normal_cnt FROM program_phases WHERE phase_set_id = set_id AND phase_type = 'normal';

    -- Accumulation (first normal phase) — add if no normal phases at all
    IF normal_cnt = 0 THEN
      SELECT COALESCE(MAX(position), -1) + 1 INTO max_pos FROM program_phases WHERE phase_set_id = set_id;
      SELECT id INTO sty_id FROM progression_styles WHERE user_id = u.id AND name = 'Hypertrophy' LIMIT 1;
      INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id)
      VALUES (gen_random_uuid(), set_id, max_pos, 'Accumulation', 4, 'normal', sty_id, sty_id);
      normal_cnt := 1;
    END IF;

    -- Intensification (second normal phase) — add if only one normal phase
    IF normal_cnt < 2 THEN
      SELECT COALESCE(MAX(position), -1) + 1 INTO max_pos FROM program_phases WHERE phase_set_id = set_id;
      SELECT id INTO sty_id FROM progression_styles WHERE user_id = u.id AND name = 'Strength' LIMIT 1;
      INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id)
      VALUES (gen_random_uuid(), set_id, max_pos, 'Intensification', 3, 'normal', sty_id, sty_id);
    END IF;

    -- Peak
    IF NOT EXISTS (SELECT 1 FROM program_phases WHERE phase_set_id = set_id AND phase_type = 'peak') THEN
      SELECT COALESCE(MAX(position), -1) + 1 INTO max_pos FROM program_phases WHERE phase_set_id = set_id;
      SELECT id INTO sty_id FROM progression_styles WHERE user_id = u.id AND name = 'Peak' LIMIT 1;
      INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id)
      VALUES (gen_random_uuid(), set_id, max_pos, 'Peak', 2, 'peak', sty_id, NULL);
    END IF;

    -- Testing
    IF NOT EXISTS (SELECT 1 FROM program_phases WHERE phase_set_id = set_id AND name = 'Testing') THEN
      SELECT COALESCE(MAX(position), -1) + 1 INTO max_pos FROM program_phases WHERE phase_set_id = set_id;
      SELECT id INTO sty_id FROM progression_styles WHERE user_id = u.id AND name = 'Testing' LIMIT 1;
      INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id)
      VALUES (gen_random_uuid(), set_id, max_pos, 'Testing', 1, 'testing', sty_id, sty_id);
    END IF;

    -- Deload
    IF NOT EXISTS (SELECT 1 FROM program_phases WHERE phase_set_id = set_id AND phase_type = 'deload') THEN
      SELECT COALESCE(MAX(position), -1) + 1 INTO max_pos FROM program_phases WHERE phase_set_id = set_id;
      SELECT id INTO sty_id FROM progression_styles WHERE user_id = u.id AND name = 'Deload' LIMIT 1;
      INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id)
      VALUES (gen_random_uuid(), set_id, max_pos, 'Deload', 1, 'deload', sty_id, NULL);
    END IF;

    -- Accessory
    IF NOT EXISTS (SELECT 1 FROM program_phases WHERE phase_set_id = set_id AND phase_type = 'accessory') THEN
      SELECT COALESCE(MAX(position), -1) + 1 INTO max_pos FROM program_phases WHERE phase_set_id = set_id;
      SELECT id INTO sty_id FROM progression_styles WHERE user_id = u.id AND name = 'General' LIMIT 1;
      INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id)
      VALUES (gen_random_uuid(), set_id, max_pos, 'Accessory', 0, 'accessory', sty_id, NULL);
    END IF;

  END LOOP;
END $$;
