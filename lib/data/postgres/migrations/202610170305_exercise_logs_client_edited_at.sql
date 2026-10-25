-- issue 2721 — a stale phone cannot overwrite a newer workout log: when the row was last edited.
--
-- A phone that edits a workout log offline pushes it later, and the push upserted unconditionally,
-- so a server-side correction made in between (the lbs-to-kg fix, a re-derived 1RM) was silently
-- reverted by the older copy. `updated_at` cannot decide which copy is newer: the
-- `trg_set_updated_at` trigger (migration 069) sets it to server write time, so a log the phone
-- made offline and then edited offline would read as older than its own first push, and the pull
-- cursor depends on it staying server time.
--
-- What this does: ADD COLUMN client_edited_at timestamptz NULL on exercise_logs. It holds the time
-- the row's content was last decided: the phone's own clock for a push that carries `editedAt`, and
-- the server's clock for a web route or a server-side fix. The push rule in `pushMutations` skips a
-- log write or edit whose `editedAt` is older than this column. Sets are always written with their
-- log, so one column on the log covers them.
--
-- Nullable, no default: a catalog-only change, no table rewrite, every existing row reads NULL, and a
-- NULL row accepts any push, exactly as before. No row is changed, backfilled or deleted.
--
-- Guards: `lock_timeout` so a long reader holding the table makes this give up (and ensureSchema
-- retry it on the next boot) rather than queue every exercise-log write behind it; `statement_timeout`
-- as a backstop. Both are SET LOCAL, scoped to this migration's transaction.
--
-- Replay-safe (CI truncates schema_migrations and re-runs everything): ADD COLUMN IF NOT EXISTS.
--
-- REVERSE (loses only the edit stamps, no workout data):
--   DROP VIEW IF EXISTS claude_ro.exercise_logs; ALTER TABLE exercise_logs DROP COLUMN client_edited_at;
--   (the view selects the column, so the DROP COLUMN fails without the DROP VIEW; the boot rebuild recreates the view from claude-ro-views.sql)

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE exercise_logs ADD COLUMN IF NOT EXISTS client_edited_at timestamptz;
