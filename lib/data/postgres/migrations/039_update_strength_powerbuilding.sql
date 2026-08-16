DO $$
DECLARE
  uid uuid;
  sid uuid;
BEGIN
  FOR uid IN SELECT id FROM users LOOP
    -- Strength: add 5th set (4×5 → 5×5)
    SELECT id INTO sid FROM progression_styles WHERE user_id = uid AND name = 'Strength';
    IF sid IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM style_sets ss WHERE ss.style_id = sid AND ss.set_number = 5
    ) THEN
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm)
      VALUES (gen_random_uuid(), sid, 5, 80, 5, 120, true);
    END IF;

    -- Powerbuilding: update from 4×8 @ 75% · 90s → 4×6 @ 80% · 120s
    SELECT id INTO sid FROM progression_styles WHERE user_id = uid AND name = 'Powerbuilding';
    IF sid IS NOT NULL THEN
      UPDATE style_sets ss SET pct = 80, reps = 6, rest_sec = 120
      WHERE ss.style_id = sid;
    END IF;
  END LOOP;
END $$;
