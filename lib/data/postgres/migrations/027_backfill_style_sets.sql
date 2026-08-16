-- 027_backfill_style_sets.sql
-- Seeded progression styles were created with only 1 set each.
-- Adds the standard additional sets for any seeded style that still has
-- exactly 1 set at the original default prescription, so user-customised
-- styles (which will have different values or counts) are left alone.

DO $$
DECLARE
  sty RECORD;
  existing_pct  DOUBLE PRECISION;
  existing_reps INTEGER;
BEGIN
  FOR sty IN
    SELECT ps.id, ps.name
    FROM progression_styles ps
    WHERE ps.name IN ('Hypertrophy', 'Strength', 'Peak', 'Deload', 'General')
      AND (SELECT COUNT(*) FROM style_sets WHERE style_id = ps.id) = 1
  LOOP
    SELECT pct, reps INTO existing_pct, existing_reps
    FROM style_sets WHERE style_id = sty.id LIMIT 1;

    IF sty.name = 'Hypertrophy' AND existing_pct = 65 AND existing_reps = 10 THEN
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sty.id, 2, 65, 10, 60, false),
        (gen_random_uuid(), sty.id, 3, 65, 10, 60, false),
        (gen_random_uuid(), sty.id, 4, 65, 10, 60, false);

    ELSIF sty.name = 'Strength' AND existing_pct = 80 AND existing_reps = 5 THEN
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sty.id, 2, 80, 5, 120, false),
        (gen_random_uuid(), sty.id, 3, 80, 5, 120, false),
        (gen_random_uuid(), sty.id, 4, 80, 5, 120, false);

    ELSIF sty.name = 'Peak' AND existing_pct = 90 AND existing_reps = 3 THEN
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sty.id, 2, 90, 3, 180, true),
        (gen_random_uuid(), sty.id, 3, 90, 3, 180, true);

    ELSIF sty.name = 'Deload' AND existing_pct = 50 AND existing_reps = 10 THEN
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sty.id, 2, 50, 10, 60, false),
        (gen_random_uuid(), sty.id, 3, 50, 10, 60, false);

    ELSIF sty.name = 'General' AND existing_pct = 60 AND existing_reps = 12 THEN
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sty.id, 2, 60, 12, 60, false),
        (gen_random_uuid(), sty.id, 3, 60, 12, 60, false);
    END IF;

  END LOOP;
END $$;
