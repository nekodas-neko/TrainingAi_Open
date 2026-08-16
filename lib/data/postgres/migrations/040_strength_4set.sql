DO $$
DECLARE
  uid uuid;
  sid uuid;
BEGIN
  FOR uid IN SELECT id FROM users LOOP
    IF NOT EXISTS (
      SELECT 1 FROM progression_styles WHERE user_id = uid AND name = 'Strength 4-set'
    ) THEN
      sid := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name, created_at)
      VALUES (sid, uid, 'Strength 4-set', now());
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm)
      VALUES
        (gen_random_uuid(), sid, 1, 80, 5, 120, true),
        (gen_random_uuid(), sid, 2, 80, 5, 120, true),
        (gen_random_uuid(), sid, 3, 80, 5, 120, true),
        (gen_random_uuid(), sid, 4, 80, 5, 120, true);
    END IF;
  END LOOP;
END $$;
