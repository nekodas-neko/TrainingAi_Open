-- 022_backfill_testing_phase.sql
-- Ensures every user's Default phase set has a Testing phase.
-- Users whose Default set was built by migration 021 from pre-existing phases
-- never had Testing added because that phase type postdates their original data.
-- Also seeds the Testing progression style for users who don't have one yet.

DO $$
DECLARE
  u         RECORD;
  set_id    UUID;
  style_id  UUID;
  max_pos   INTEGER;
  new_style UUID;
BEGIN
  FOR u IN SELECT id FROM users LOOP

    -- 1. Ensure Testing progression style exists for this user
    SELECT id INTO style_id
    FROM progression_styles
    WHERE user_id = u.id AND name = 'Testing'
    LIMIT 1;

    IF style_id IS NULL THEN
      new_style := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name)
      VALUES (new_style, u.id, 'Testing');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), new_style, 1, 55, 5,  90,  false),
        (gen_random_uuid(), new_style, 2, 70, 3,  120, false),
        (gen_random_uuid(), new_style, 3, 87, 5,  180, true);
      style_id := new_style;
    END IF;

    -- 2. Add Testing phase to Default phase set if missing
    SELECT id INTO set_id
    FROM phase_sets
    WHERE user_id = u.id AND is_default = true
    LIMIT 1;

    IF set_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM program_phases
        WHERE phase_set_id = set_id AND name = 'Testing'
      ) THEN
        SELECT COALESCE(MAX(position), -1) + 1 INTO max_pos
        FROM program_phases WHERE phase_set_id = set_id;

        INSERT INTO program_phases (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id)
        VALUES (gen_random_uuid(), set_id, max_pos, 'Testing', 1, 'testing', style_id, style_id);
      END IF;
    END IF;

  END LOOP;
END $$;
