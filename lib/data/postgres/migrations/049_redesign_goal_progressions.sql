-- 049_redesign_goal_progressions.sql
-- Redesigns Hypertrophy, S+H, and Strength progressions for clear goal differentiation.
-- Powerbuilding Progression is unchanged.
--
-- New styles:
--   Hypertrophy Peak    — 4×6@75%, 90s  (Hyp Peak)
--   S+H Intensification — 4×6@75%, 90s  (S+H Int)
--   Strength Accumulation  — 5×4@85%, 180s (Str Acc)
--   Strength Intensification — 5×3@90%, 210s (Str Int)
--
-- Updated:
--   Max Strength → 4×2@92%, 240s (was 3×3@92%)
--
-- Phase progression after this migration:
--   Hypertrophy:   Acc=Gen4set(~65%) → Int=HypPlus(4×8@70%) → Peak=HypPeak(4×6@75%)  [60–75%]
--   S+H:           Acc=HypPlus(4×8@70%) → Int=SHInt(4×6@75%) → Peak=Str4set(4×5@80%) [65–80%]
--   Powerbuilding: Acc=PB(4×6@80%) → Int=HeavyStr(5×5@85%) → Peak=Peak(3×3@90%)      [80–90%]
--   Strength:      Acc=StrAcc(5×4@85%) → Int=StrInt(5×3@90%) → Peak=MaxStr(4×2@92%)  [85–92%]

DO $$
DECLARE
  uid         uuid;
  sid         uuid;
  ms_id       uuid;
  hyp_pk_id   uuid;
  sh_int_id   uuid;
  str_acc_id  uuid;
  str_int_id  uuid;
  hyp_plus_id uuid;
  ps_id       uuid;
BEGIN
  FOR uid IN SELECT id FROM users LOOP

    -- ── Create new styles (idempotent) ────────────────────────────────────────

    IF NOT EXISTS (SELECT 1 FROM progression_styles WHERE user_id = uid AND name = 'Hypertrophy Peak') THEN
      sid := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name) VALUES (sid, uid, 'Hypertrophy Peak');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sid, 1, 75, 6, 90, false),
        (gen_random_uuid(), sid, 2, 75, 6, 90, false),
        (gen_random_uuid(), sid, 3, 75, 6, 90, false),
        (gen_random_uuid(), sid, 4, 75, 6, 90, false);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM progression_styles WHERE user_id = uid AND name = 'S+H Intensification') THEN
      sid := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name) VALUES (sid, uid, 'S+H Intensification');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sid, 1, 75, 6, 90, false),
        (gen_random_uuid(), sid, 2, 75, 6, 90, false),
        (gen_random_uuid(), sid, 3, 75, 6, 90, false),
        (gen_random_uuid(), sid, 4, 75, 6, 90, false);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM progression_styles WHERE user_id = uid AND name = 'Strength Accumulation') THEN
      sid := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name) VALUES (sid, uid, 'Strength Accumulation');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sid, 1, 85, 4, 180, true),
        (gen_random_uuid(), sid, 2, 85, 4, 180, true),
        (gen_random_uuid(), sid, 3, 85, 4, 180, true),
        (gen_random_uuid(), sid, 4, 85, 4, 180, true),
        (gen_random_uuid(), sid, 5, 85, 4, 180, true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM progression_styles WHERE user_id = uid AND name = 'Strength Intensification') THEN
      sid := gen_random_uuid();
      INSERT INTO progression_styles (id, user_id, name) VALUES (sid, uid, 'Strength Intensification');
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), sid, 1, 90, 3, 210, true),
        (gen_random_uuid(), sid, 2, 90, 3, 210, true),
        (gen_random_uuid(), sid, 3, 90, 3, 210, true),
        (gen_random_uuid(), sid, 4, 90, 3, 210, true),
        (gen_random_uuid(), sid, 5, 90, 3, 210, true);
    END IF;

    -- ── Update Max Strength to 4×2@92% (was 3×3@92%) ─────────────────────────

    SELECT id INTO ms_id FROM progression_styles WHERE user_id = uid AND name = 'Max Strength' LIMIT 1;
    IF ms_id IS NOT NULL THEN
      DELETE FROM style_sets WHERE style_id = ms_id;
      INSERT INTO style_sets (id, style_id, set_number, pct, reps, rest_sec, use_for_1rm) VALUES
        (gen_random_uuid(), ms_id, 1, 92, 2, 240, true),
        (gen_random_uuid(), ms_id, 2, 92, 2, 240, true),
        (gen_random_uuid(), ms_id, 3, 92, 2, 240, true),
        (gen_random_uuid(), ms_id, 4, 92, 2, 240, true);
    END IF;

    -- ── Resolve IDs ───────────────────────────────────────────────────────────

    SELECT id INTO hyp_pk_id   FROM progression_styles WHERE user_id = uid AND name = 'Hypertrophy Peak'        LIMIT 1;
    SELECT id INTO sh_int_id   FROM progression_styles WHERE user_id = uid AND name = 'S+H Intensification'     LIMIT 1;
    SELECT id INTO str_acc_id  FROM progression_styles WHERE user_id = uid AND name = 'Strength Accumulation'   LIMIT 1;
    SELECT id INTO str_int_id  FROM progression_styles WHERE user_id = uid AND name = 'Strength Intensification' LIMIT 1;
    SELECT id INTO hyp_plus_id FROM progression_styles WHERE user_id = uid AND name = 'Hypertrophy Plus'        LIMIT 1;

    -- ── Update Hypertrophy Progression ────────────────────────────────────────
    -- Int: Hypertrophy → Hypertrophy Plus (4×8@70%)
    -- Peak: Hypertrophy Plus → Hypertrophy Peak (4×6@75%)

    SELECT id INTO ps_id FROM phase_sets WHERE user_id = uid AND name = 'Hypertrophy Progression' LIMIT 1;
    IF ps_id IS NOT NULL THEN
      UPDATE program_phases
        SET primary_style_id = hyp_plus_id, secondary_style_id = hyp_plus_id
        WHERE phase_set_id = ps_id AND name = 'Intensification';
      UPDATE program_phases
        SET primary_style_id = hyp_pk_id, secondary_style_id = hyp_pk_id
        WHERE phase_set_id = ps_id AND name = 'Peak';
    END IF;

    -- ── Update S+H Progression ────────────────────────────────────────────────
    -- Acc: Hypertrophy → Hypertrophy Plus (4×8@70%)
    -- Int: Hypertrophy Plus → S+H Intensification (4×6@75%)
    -- Peak: Strength 4-set (4×5@80%) — unchanged

    SELECT id INTO ps_id FROM phase_sets WHERE user_id = uid AND name = 'S+H Progression' LIMIT 1;
    IF ps_id IS NOT NULL THEN
      UPDATE program_phases
        SET primary_style_id = hyp_plus_id, secondary_style_id = hyp_plus_id
        WHERE phase_set_id = ps_id AND name = 'Accumulation';
      UPDATE program_phases
        SET primary_style_id = sh_int_id, secondary_style_id = sh_int_id
        WHERE phase_set_id = ps_id AND name = 'Intensification';
    END IF;

    -- ── Update Strength Progression ───────────────────────────────────────────
    -- Acc: Strength → Strength Accumulation (5×4@85%)
    -- Int: Strength Plus → Strength Intensification (5×3@90%)
    -- Peak: Max Strength — link unchanged, but style is now 4×2@92%

    SELECT id INTO ps_id FROM phase_sets WHERE user_id = uid AND name = 'Strength Progression' LIMIT 1;
    IF ps_id IS NOT NULL THEN
      UPDATE program_phases
        SET primary_style_id = str_acc_id, secondary_style_id = str_acc_id
        WHERE phase_set_id = ps_id AND name = 'Accumulation';
      UPDATE program_phases
        SET primary_style_id = str_int_id, secondary_style_id = str_int_id
        WHERE phase_set_id = ps_id AND name = 'Intensification';
    END IF;

  END LOOP;
END $$;
