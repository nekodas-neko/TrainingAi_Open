-- 023_backfill_standard_phases.sql
-- Ensures every Default phase set has all standard phase types.
-- Migration 021 built Default sets from pre-existing phases, so users with
-- minimal original setups (e.g. only Accumulation/Peak) are missing Deload,
-- Accessory, etc. Checks by phase_type so renamed phases are not duplicated.

DO $$
DECLARE
  u       RECORD;
  set_id  UUID;
  max_pos INTEGER;
  sty_id  UUID;
BEGIN
  FOR u IN SELECT id FROM users LOOP
    SELECT id INTO set_id
    FROM phase_sets WHERE user_id = u.id AND is_default = true LIMIT 1;
    IF set_id IS NULL THEN CONTINUE; END IF;

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
