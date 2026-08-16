-- 028_fix_style_set_counts.sql
-- Migration 027 guarded on exact pct/reps float comparisons that may not
-- match due to storage representation. This migration reads the first set's
-- values directly and copies them, so it works regardless of actual values.
-- Idempotent: COUNT=1 outer guard + ON CONFLICT (style_id, set_number) DO NOTHING.

DO $$
DECLARE
  sty RECORD;
  s1  RECORD;
BEGIN
  FOR sty IN
    SELECT ps.id, ps.name
    FROM progression_styles ps
    WHERE ps.name IN ('Strength', 'Peak', 'Deload', 'General')
      AND (SELECT COUNT(*) FROM style_sets WHERE style_id = ps.id) = 1
  LOOP
    SELECT * INTO s1 FROM style_sets WHERE style_id = sty.id ORDER BY set_number LIMIT 1;

    IF sty.name IN ('Strength', 'Deload', 'General') THEN
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sty.id, 2, s1.pct, s1.reps, s1.rest_sec, s1.use_for_1rm),
        (gen_random_uuid(), sty.id, 3, s1.pct, s1.reps, s1.rest_sec, s1.use_for_1rm),
        (gen_random_uuid(), sty.id, 4, s1.pct, s1.reps, s1.rest_sec, s1.use_for_1rm)
      ON CONFLICT (style_id, set_number) DO NOTHING;

    ELSIF sty.name = 'Peak' THEN
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sty.id, 2, s1.pct, s1.reps, s1.rest_sec, s1.use_for_1rm),
        (gen_random_uuid(), sty.id, 3, s1.pct, s1.reps, s1.rest_sec, s1.use_for_1rm)
      ON CONFLICT (style_id, set_number) DO NOTHING;
    END IF;
  END LOOP;
END $$;
