-- Ensures Powerbuilding is exactly 4×6@80%·120s for every user.
-- Migration 038 created it as 4×8@75%·90s; migration 039 updated existing rows to reps=6,pct=80.
-- This migration is a hard reset to guarantee correctness regardless of prior migration state:
-- create the style if missing, then replace all its set rows with the canonical prescription.
DO $$
DECLARE
  uid uuid;
  sid uuid;
BEGIN
  FOR uid IN SELECT id FROM users LOOP
    -- Create style if not present
    IF NOT EXISTS (SELECT 1 FROM progression_styles WHERE user_id = uid AND name = 'Powerbuilding') THEN
      sid := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name, created_at)
      VALUES (sid, uid, 'Powerbuilding', now());
    ELSE
      SELECT id INTO sid FROM progression_styles WHERE user_id = uid AND name = 'Powerbuilding';
    END IF;

    -- Replace all set rows with canonical 4×6@80%·120s prescription
    DELETE FROM style_sets WHERE style_id = sid;
    INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
      (gen_random_uuid(), sid, 1, 80, 6, 120, true),
      (gen_random_uuid(), sid, 2, 80, 6, 120, true),
      (gen_random_uuid(), sid, 3, 80, 6, 120, true),
      (gen_random_uuid(), sid, 4, 80, 6, 120, true);
  END LOOP;
END $$;
