DO $$
DECLARE
  uid uuid;
  style_id uuid;
BEGIN
  FOR uid IN SELECT id FROM users LOOP
    IF NOT EXISTS (
      SELECT 1 FROM progression_styles WHERE user_id = uid AND name = 'Powerbuilding'
    ) THEN
      style_id := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name, created_at)
      VALUES (style_id, uid, 'Powerbuilding', now());
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm)
      VALUES
        (gen_random_uuid(), style_id, 1, 75, 8, 90, true),
        (gen_random_uuid(), style_id, 2, 75, 8, 90, true),
        (gen_random_uuid(), style_id, 3, 75, 8, 90, true),
        (gen_random_uuid(), style_id, 4, 75, 8, 90, true);
    END IF;
  END LOOP;
END $$;
