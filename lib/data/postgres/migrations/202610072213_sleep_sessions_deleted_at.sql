-- issue 2606 — a night the user typed in can be removed: a `deleted_at` tombstone on sleep_sessions.
--
-- The owner chose "Remove" on 2026-10-07 (the approved manual-sleep-entry mockup shows a hand-logged
-- night with Edit and Remove night). A server hard delete is invisible to a device that has not
-- synced (docs/rules/offline-first-and-storage.md), so a removal is a tombstone: the row stays, every
-- reader skips it, and the delta pull carries `deleted_at` to the device like every other
-- tombstoned domain. Only a row with `manual_entry = true` can ever be tombstoned
-- (`deleteManualSleepNight`); a night a device measured is never removed this way.
--
-- What this does:
--   1. ADD COLUMN deleted_at timestamptz NULL. Nullable, no default: a catalog-only change, no
--      table rewrite, every existing row reads NULL (live). No row is changed or deleted.
--   2. The partial unique key `sleep_sessions_manual_night_key` (one manual night per user + wake
--      date, migration 202610071309) becomes `WHERE manual_entry AND deleted_at IS NULL`: the key is
--      about the LIVE night. A removed night does not hold the date. The index is dropped and
--      rebuilt inside this migration's transaction, so there is no moment a concurrent insert could
--      see neither. Every row that satisfies the new predicate satisfied the old one, so the build
--      cannot find a duplicate the old index allowed. sleep_sessions is small (hundreds of rows per
--      user), and the partial index covers only manual nights, so the build is milliseconds.
--
-- Additive: one nullable column and an index swap. Nothing is rewritten, backfilled or deleted.
--
-- Guards: `lock_timeout` so a long reader holding the table makes this give up (and ensureSchema
-- retry it on the next boot) rather than queue every sleep write behind it; `statement_timeout` as a
-- backstop. Both are SET LOCAL, scoped to this migration's transaction.
--
-- Replay-safe (CI truncates schema_migrations and re-runs everything): ADD COLUMN IF NOT EXISTS, and
-- the index is rebuilt only while its definition does not already mention deleted_at.
--
-- REVERSE (only if no row has been tombstoned, or after deciding what a tombstoned night becomes):
--   DROP INDEX IF EXISTS sleep_sessions_manual_night_key;
--   CREATE UNIQUE INDEX sleep_sessions_manual_night_key ON sleep_sessions (user_id, date) WHERE manual_entry;
--   ALTER TABLE sleep_sessions DROP COLUMN deleted_at;
--
-- Verify after release (admin query endpoint):
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'sleep_sessions_manual_night_key';
-- Expected: ... (user_id, date) WHERE (manual_entry AND (deleted_at IS NULL))

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '1min';

ALTER TABLE sleep_sessions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DO $$
DECLARE
  def text;
BEGIN
  SELECT indexdef INTO def FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'sleep_sessions_manual_night_key';

  IF def IS NOT NULL AND def LIKE '%deleted_at%' THEN
    RAISE NOTICE 'issue 2606: sleep_sessions_manual_night_key already excludes removed nights; nothing to do';
    RETURN;
  END IF;

  DROP INDEX IF EXISTS sleep_sessions_manual_night_key;
  CREATE UNIQUE INDEX sleep_sessions_manual_night_key
    ON sleep_sessions (user_id, date)
    WHERE manual_entry AND deleted_at IS NULL;
  RAISE NOTICE 'issue 2606: sleep_sessions_manual_night_key now covers live manual nights only';
END $$;
