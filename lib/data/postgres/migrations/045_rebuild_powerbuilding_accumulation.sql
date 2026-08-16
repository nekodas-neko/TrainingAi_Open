-- 045_rebuild_powerbuilding_accumulation.sql
-- Deletes and re-inserts the Accumulation phase row in every user's
-- "Powerbuilding Progression" phase set with the correct Powerbuilding style ID.
-- Previous UPDATE migrations (043, 044) were silently matching 0 rows.

DO $$
DECLARE
  uid            uuid;
  ps_id          uuid;
  powerblding_id uuid;
BEGIN
  FOR uid IN SELECT id FROM users LOOP
    SELECT id INTO ps_id
      FROM phase_sets
      WHERE user_id = uid AND name = 'Powerbuilding Progression'
      LIMIT 1;
    IF ps_id IS NULL THEN CONTINUE; END IF;

    SELECT id INTO powerblding_id
      FROM progression_styles
      WHERE user_id = uid AND name = 'Powerbuilding'
      LIMIT 1;
    IF powerblding_id IS NULL THEN CONTINUE; END IF;

    DELETE FROM program_phases
      WHERE phase_set_id = ps_id AND name = 'Accumulation';

    INSERT INTO program_phases
      (id, phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id)
    VALUES
      (gen_random_uuid(), ps_id, 0, 'Accumulation', 4, 'normal', powerblding_id, powerblding_id);
  END LOOP;
END $$;
