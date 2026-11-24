-- #2412 step 2 — drop the dead column workout_sessions.program_session_id.
--
-- Owner approved 2026-11-19. The column was added by 079 "for prescription trigger linkage" and never
-- used: the live link to program_sessions is `session_id`. It was NULL on all 124 of the owner's
-- production rows when measured, and no code reads or writes it. Step 1 (#3697) stopped
-- `schema.ts` declaring it, so no deployed build selects it. Ship this only in a release that
-- contains #3697 and after a verified production snapshot.
--
-- ⚠ `session_periodization.program_session_id` and `prescription_shadow.program_session_id` are
-- different, LIVE columns on other tables. This migration touches workout_sessions only.
--
-- What hangs off the column, checked against the schema:
--   * foreign key workout_sessions_program_session_id_fkey (DEFERRABLE, ON DELETE SET NULL): dropped
--     with the column.
--   * no index, no trigger that names it, no generated column, no CHECK.
--   * the claude_ro.workout_sessions view selects it by name, so the view goes first, as in 294.
--     claude-ro-views.sql, regenerated in this PR, recreates it after the migrations in the same
--     deploy.
--
-- The DEVICE has no such column (neither the web local store nor the native SQLite), so nothing to
-- change there.
--
-- Guarded on the owner-only measurement: claude_ro sees the owner's rows, so a count of rows in any
-- account that still hold a value is logged before the drop. The drop proceeds regardless (the owner
-- chose it, and a snapshot comes first); the notice makes any surprise visible in the deploy log.
--
-- Locking: ALTER TABLE ... DROP COLUMN takes ACCESS EXCLUSIVE on workout_sessions, plus a brief lock
-- on program_sessions to remove the FK. It rewrites nothing (the column is marked dropped in the
-- catalog); on a table of a few hundred rows it is held for milliseconds. `lock_timeout` makes it
-- give up, and ensureSchema retry on the next boot, rather than queue every workout write behind a
-- long reader. Both settings are SET LOCAL, scoped to this migration's transaction.
--
-- Replay-safe (CI truncates schema_migrations and re-runs everything): DROP VIEW IF EXISTS,
-- DROP COLUMN IF EXISTS, and the count only runs while the column exists.
--
-- REVERSE (nothing needs back-filling: the column was NULL on every row):
--   ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS program_session_id uuid;
--   ALTER TABLE workout_sessions ADD CONSTRAINT workout_sessions_program_session_id_fkey
--     FOREIGN KEY (program_session_id) REFERENCES program_sessions(id) ON DELETE SET NULL DEFERRABLE;
--   (the boot rebuild recreates the claude_ro view from claude-ro-views.sql; revert the schema file
--   too if the column should be declared again, which it should not be)

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '1min';

DO $$
DECLARE
  n bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workout_sessions' AND column_name = 'program_session_id'
  ) THEN
    EXECUTE 'SELECT count(*) FROM workout_sessions WHERE program_session_id IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE NOTICE '#2412: dropping workout_sessions.program_session_id with % non-null row(s)', n;
    END IF;
  END IF;
END $$;

DROP VIEW IF EXISTS claude_ro.workout_sessions;

ALTER TABLE workout_sessions DROP COLUMN IF EXISTS program_session_id;
