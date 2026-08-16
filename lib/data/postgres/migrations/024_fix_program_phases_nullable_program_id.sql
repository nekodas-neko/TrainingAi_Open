-- 024_fix_program_phases_nullable_program_id.sql
-- Migration 020 created program_id as NOT NULL.
-- Migration 021 added phase_set_id but never made program_id nullable,
-- so all attempts to insert phase-set-only phases (022, 023, upsertUser seeding)
-- silently fail with a NOT NULL violation.
--
-- This migration:
--   1. Makes program_id nullable
--   2. Replaces the (program_id, position) unique constraint with (phase_set_id, position)
--   3. Re-runs the Testing / Deload / Accessory backfills that 022 and 023 attempted

-- 1. Make program_id nullable
DO $$ BEGIN
  ALTER TABLE program_phases ALTER COLUMN program_id DROP NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

-- 2. Replace unique constraint
DO $$ BEGIN
  ALTER TABLE program_phases DROP CONSTRAINT IF EXISTS program_phases_program_id_position_key;
  ALTER TABLE program_phases DROP CONSTRAINT IF EXISTS program_phases_phase_set_id_position_key;
  -- Partial unique index: only enforce uniqueness when phase_set_id is not null
  -- (program_id-keyed rows keep their existing implicit uniqueness via program_id+position data)
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS program_phases_phase_set_id_position_idx
  ON program_phases (phase_set_id, position)
  WHERE phase_set_id IS NOT NULL;

-- 3. Backfill: Testing style + all missing standard phases for every Default phase set
DO $$
DECLARE
  u        RECORD;
  set_id   UUID;
  max_pos  INTEGER;
  sty_id   UUID;
  new_sty  UUID;
BEGIN
  FOR u IN SELECT id FROM users LOOP

    -- Ensure Testing progression style exists
    SELECT id INTO sty_id FROM progression_styles WHERE user_id = u.id AND name = 'Testing' LIMIT 1;
    IF sty_id IS NULL THEN
      new_sty := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name) VALUES (new_sty, u.id, 'Testing');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), new_sty, 1, 55, 5,  90,  false),
        (gen_random_uuid(), new_sty, 2, 70, 3,  120, false),
        (gen_random_uuid(), new_sty, 3, 87, 5,  180, true);
      sty_id := new_sty;
    END IF;

    SELECT id INTO set_id FROM phase_sets WHERE user_id = u.id AND is_default = true LIMIT 1;
    IF set_id IS NULL THEN CONTINUE; END IF;

    -- Testing phase
    IF NOT EXISTS (SELECT 1 FROM program_phases WHERE phase_set_id = set_id AND name = 'Testing') THEN
      SELECT COALESCE(MAX(position), -1) + 1 INTO max_pos FROM program_phases WHERE phase_set_id = set_id;
      INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id)
      VALUES (gen_random_uuid(), set_id, max_pos, 'Testing', 1, 'testing', sty_id, sty_id);
    END IF;

    -- Deload phase
    IF NOT EXISTS (SELECT 1 FROM program_phases WHERE phase_set_id = set_id AND phase_type = 'deload') THEN
      SELECT COALESCE(MAX(position), -1) + 1 INTO max_pos FROM program_phases WHERE phase_set_id = set_id;
      SELECT id INTO sty_id FROM progression_styles WHERE user_id = u.id AND name = 'Deload' LIMIT 1;
      INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id)
      VALUES (gen_random_uuid(), set_id, max_pos, 'Deload', 1, 'deload', sty_id, NULL);
    END IF;

    -- Accessory phase
    IF NOT EXISTS (SELECT 1 FROM program_phases WHERE phase_set_id = set_id AND phase_type = 'accessory') THEN
      SELECT COALESCE(MAX(position), -1) + 1 INTO max_pos FROM program_phases WHERE phase_set_id = set_id;
      SELECT id INTO sty_id FROM progression_styles WHERE user_id = u.id AND name = 'General' LIMIT 1;
      INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id)
      VALUES (gen_random_uuid(), set_id, max_pos, 'Accessory', 0, 'accessory', sty_id, NULL);
    END IF;

  END LOOP;
END $$;
