-- LA-143 — fill session_exercises.exercise_id on rows saved before RV-168 made saveProgram set it.
-- Migration 099's own backfill, re-run, and WHERE exercise_id IS NULL so a Coach-set value is never
-- overwritten. exercise_library.name is UNIQUE, so each name matches at most one row.
--
-- Authorised under the owner's 2026-09-27 policy (OR-182): an ADD/backfill, nothing deleted.
-- Measured on production 2026-09-28: the owner's 112 rows, 88 NULL, all 88 matchable. The pre-image
-- (those 88 ids) was saved before merge, and the undo is exact: SET exercise_id = NULL on them.
--
-- It checks its own count and refuses a mismatch: the rows it updates must be exactly the NULL rows
-- with a matching name, counted immediately before. Replay-safe: a second run matches nothing.
DO $$
DECLARE
  predicted integer;
  affected integer;
BEGIN
  SELECT count(*) INTO predicted
    FROM session_exercises se
   WHERE se.exercise_id IS NULL
     AND EXISTS (SELECT 1 FROM exercise_library el WHERE el.name = se.exercise_name);

  UPDATE session_exercises se SET exercise_id = el.id
    FROM exercise_library el
   WHERE el.name = se.exercise_name AND se.exercise_id IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;

  IF affected <> predicted THEN
    RAISE EXCEPTION 'LA-143: backfill touched % rows, predicted %; rolled back', affected, predicted;
  END IF;
  RAISE NOTICE 'LA-143: backfilled % session_exercises.exercise_id', affected;
END $$;
