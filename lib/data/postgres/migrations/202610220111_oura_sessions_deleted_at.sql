-- #3153: a tombstone column for Oura's sessions (meditation, breathing, nap, rest …).
--
-- A session the owner deletes in the Oura app has to leave the day timeline, which reads
-- oura_sessions. Oura reports that as a `session` delete event, and the daily reconcile can see a
-- session gone from a day it re-reads. Both mark the row here rather than deleting it: a server hard
-- delete is invisible to a device that has not synced (docs/rules/offline-first-and-storage.md), and
-- deleting data is the owner's call (#3155 review). Same shape as oura_workouts.deleted_at (#3147).
--
-- Additive only: one nullable column with no default, a catalog-only change with no rewrite. No
-- row is changed, backfilled or deleted. Until the code that writes it runs, every row reads as live,
-- which is today's behaviour.
--
-- Guards: `lock_timeout` so a long reader on oura_sessions makes this give up (and ensureSchema
-- retry it on the next boot) rather than queue writers behind it; `statement_timeout` as a
-- backstop. Both are SET LOCAL, scoped to this migration's transaction.
--
-- REVERSE (loses only the tombstones written into it):
--   ALTER TABLE oura_sessions DROP COLUMN deleted_at;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE oura_sessions ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
