-- #3153: a tombstone column for Oura's sessions (meditation, breathing, nap, rest …).
--
-- A session the owner deletes in the Oura app has to leave the day timeline, which reads
-- oura_sessions. Oura reports that as a `session` delete event, and the daily reconcile can see a
-- session gone from a day it re-reads. Both mark the row here rather than deleting it: a server hard
-- delete is invisible to a device that has not synced (docs/rules/offline-first-and-storage.md), and
-- deleting data is the owner's call (#3155 review). Same shape as oura_workouts.deleted_at (#3147).
--
-- Ships alone, before the code that writes and reads it (CLAUDE.md: a migration never rides in a
-- batch with anything else; `ensureSchema` logs a failed migration and serves anyway, so code naming
-- the column must not land before it). Until that code lands, nothing writes the column and every
-- row reads as live, which is today's behaviour.
--
-- Additive only: one nullable column with no default, a catalog-only change with no rewrite. No
-- row is changed, backfilled or deleted.
--
-- Guards: `lock_timeout` so a long reader on oura_sessions makes this give up (and ensureSchema
-- retry it on the next boot) rather than queue writers behind it; `statement_timeout` as a
-- backstop. Both are SET LOCAL, scoped to this migration's transaction.
--
-- REVERSE (loses only the tombstones written into it). claude_ro.oura_sessions names the column, so
-- the view goes first, or the DROP COLUMN fails:
--   DROP VIEW IF EXISTS claude_ro.oura_sessions;
--   ALTER TABLE oura_sessions DROP COLUMN deleted_at;
-- The boot rebuild of claude-ro-views.sql recreates the view, once the column is out of schema.ts and
-- the file is regenerated without it. That rebuild is gated on the file's hash in schema_migrations:
-- if the regenerated file matches one already recorded (the pre-#3153 views), delete that marker row
-- so the next boot applies it.

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE oura_sessions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
