-- 048_fix_strength4set_and_sh_peak.sql
-- Migration 040 used `created_at` in its INSERT into progression_styles, a column
-- that no longer exists. The DO block silently rolled back, so 'Strength 4-set' was
-- never created for any user who existed before 040 ran. As a result, migration 042
-- stored NULL as the primary_style_id for the S+H Progression Peak phase (str4_id
-- was NULL at that time), and migration 047 could not fix it because it also read
-- NULL for str4_id and wrote NULL back.
--
-- This migration:
--   1. Creates 'Strength 4-set' for any user who is missing it (no created_at).
--   2. Unconditionally re-resolves the S+H Progression Peak → Strength 4-set link.

DO $$
DECLARE
  uid    uuid;
  sid    uuid;
  str4_id uuid;
  ps_id  uuid;
BEGIN
  FOR uid IN SELECT id FROM users LOOP

    -- Ensure 'Strength 4-set' exists for this user
    IF NOT EXISTS (SELECT 1 FROM progression_styles WHERE user_id = uid AND name = 'Strength 4-set') THEN
      sid := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name) VALUES (sid, uid, 'Strength 4-set');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sid, 1, 80, 5, 120, true),
        (gen_random_uuid(), sid, 2, 80, 5, 120, true),
        (gen_random_uuid(), sid, 3, 80, 5, 120, true),
        (gen_random_uuid(), sid, 4, 80, 5, 120, true);
    END IF;

    -- Resolve str4_id now that we know the style exists
    SELECT id INTO str4_id FROM progression_styles WHERE user_id = uid AND name = 'Strength 4-set' LIMIT 1;

    -- Re-link S+H Progression Peak phase → Strength 4-set
    SELECT id INTO ps_id FROM phase_sets WHERE user_id = uid AND name = 'S+H Progression' LIMIT 1;
    IF ps_id IS NOT NULL AND str4_id IS NOT NULL THEN
      UPDATE program_phases
        SET primary_style_id = str4_id, secondary_style_id = str4_id
        WHERE phase_set_id = ps_id AND name = 'Peak';
    END IF;

  END LOOP;
END $$;
