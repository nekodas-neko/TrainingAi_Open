-- LA-177. Give every styleless slot in an ACTIVE program the style its ROLE most uses in that same
-- program. A slot with no style records no per-set plan, and the rules fallback (BF-198's Full
-- revert, and any day the AI is unavailable) skips it outright: the owner's Lower session revived
-- nothing because all five of its slots were styleless.
--
-- Why by role within the program, and not one style for all: the same exercise legitimately runs
-- different styles in different slots (Barbell Skull Crusher carries two), so only the slot has an
-- answer, and its role is the best evidence of which. A role with NO styled slot in its program is
-- left alone rather than guessed. A tie is broken by style name, so the result is deterministic.
--
-- Inactive programs are out of scope on purpose (LA-177): nothing prescribes from them.
-- Safe to re-run: the target is `style_id IS NULL`, so a second run finds nothing.
-- New slots cannot recreate the gap: LB-186 made the editor and the builder default a style.
DO $$
DECLARE
  predicted integer;
  affected integer;
BEGIN
  DROP TABLE IF EXISTS la177_pick;
  CREATE TEMP TABLE la177_pick ON COMMIT DROP AS
  WITH slots AS (
    SELECT se.id, se.style_id, se.exercise_role, ps.program_id
      FROM session_exercises se
      JOIN program_sessions ps ON ps.id = se.session_id AND ps.deleted_at IS NULL
      JOIN programs p ON p.id = ps.program_id AND p.is_active
     WHERE se.deleted_at IS NULL
  ),
  mode_per_role AS (
    SELECT DISTINCT ON (s.program_id, s.exercise_role) s.program_id, s.exercise_role, s.style_id
      FROM slots s
      JOIN progression_styles st ON st.id = s.style_id
     WHERE s.style_id IS NOT NULL
     GROUP BY s.program_id, s.exercise_role, s.style_id, st.name
     ORDER BY s.program_id, s.exercise_role, count(*) DESC, st.name
  )
  SELECT s.id, m.style_id
    FROM slots s
    JOIN mode_per_role m ON m.program_id = s.program_id AND m.exercise_role = s.exercise_role
   WHERE s.style_id IS NULL;

  SELECT count(*) INTO predicted FROM la177_pick;

  UPDATE session_exercises se SET style_id = pick.style_id, updated_at = now()
    FROM la177_pick pick
   WHERE se.id = pick.id AND se.style_id IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;

  IF affected <> predicted THEN
    RAISE EXCEPTION 'LA-177: backfill touched % rows, predicted %; rolled back', affected, predicted;
  END IF;
  RAISE NOTICE 'LA-177: gave % styleless active-program slots their role''s most-used style', affected;
END $$;
