-- 037_style_variants.sql
-- Add 3-set and 4-set progression style variants for all existing users.
-- Idempotent: skips users who already have the style by name.

DO $$
DECLARE
  u RECORD;
  new_style_id UUID;
BEGIN
  FOR u IN SELECT id FROM users LOOP

    -- Hypertrophy 3-set (3 × 10 @ 65%, 60s rest)
    IF NOT EXISTS (
      SELECT 1 FROM progression_styles WHERE user_id = u.id AND name = 'Hypertrophy 3-set'
    ) THEN
      new_style_id := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name) VALUES (new_style_id, u.id, 'Hypertrophy 3-set');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), new_style_id, 1, 65, 10, 60, false),
        (gen_random_uuid(), new_style_id, 2, 65, 10, 60, false),
        (gen_random_uuid(), new_style_id, 3, 65, 10, 60, false);
    END IF;

    -- Strength 3-set (3 × 5 @ 80%, 120s rest)
    IF NOT EXISTS (
      SELECT 1 FROM progression_styles WHERE user_id = u.id AND name = 'Strength 3-set'
    ) THEN
      new_style_id := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name) VALUES (new_style_id, u.id, 'Strength 3-set');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), new_style_id, 1, 80, 5, 120, false),
        (gen_random_uuid(), new_style_id, 2, 80, 5, 120, false),
        (gen_random_uuid(), new_style_id, 3, 80, 5, 120, false);
    END IF;

    -- Peak 4-set (4 × 3 @ 90%, 180s rest, useFor1rm=true)
    IF NOT EXISTS (
      SELECT 1 FROM progression_styles WHERE user_id = u.id AND name = 'Peak 4-set'
    ) THEN
      new_style_id := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name) VALUES (new_style_id, u.id, 'Peak 4-set');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), new_style_id, 1, 90, 3, 180, true),
        (gen_random_uuid(), new_style_id, 2, 90, 3, 180, true),
        (gen_random_uuid(), new_style_id, 3, 90, 3, 180, true),
        (gen_random_uuid(), new_style_id, 4, 90, 3, 180, true);
    END IF;

    -- General 4-set (4 × 12 @ 60%, 60s rest)
    IF NOT EXISTS (
      SELECT 1 FROM progression_styles WHERE user_id = u.id AND name = 'General 4-set'
    ) THEN
      new_style_id := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name) VALUES (new_style_id, u.id, 'General 4-set');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), new_style_id, 1, 60, 12, 60, false),
        (gen_random_uuid(), new_style_id, 2, 60, 12, 60, false),
        (gen_random_uuid(), new_style_id, 3, 60, 12, 60, false),
        (gen_random_uuid(), new_style_id, 4, 60, 12, 60, false);
    END IF;

  END LOOP;
END $$;
