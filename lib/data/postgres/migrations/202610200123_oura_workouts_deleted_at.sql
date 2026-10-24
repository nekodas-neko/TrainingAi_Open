-- #3087: a tombstone column for Oura's own workouts.
--
-- Oura's workouts now feed the energy budget (#3141), so a workout the owner deletes in the Oura app
-- has to stop counting. Oura reports that as a `workout` delete event, and the daily reconcile can
-- see a workout gone from a day it re-reads. Both mark the row here rather than deleting it: a
-- server hard delete is invisible to a device that has not synced (docs/rules/
-- offline-first-and-storage.md), and the row's history stays readable.
--
-- Shipped alone, before the code that writes and reads it (CLAUDE.md: a migration never rides in a
-- batch with anything else). Until that code lands, nothing writes the column and every row reads
-- as live, which is today's behaviour.
--
-- Additive only: one nullable column with no default, a catalog-only change with no rewrite. No
-- row is changed, backfilled or deleted.
--
-- Guards: `lock_timeout` so a long reader on oura_workouts makes this give up (and ensureSchema
-- retry it on the next boot) rather than queue writers behind it; `statement_timeout` as a
-- backstop. Both are SET LOCAL, scoped to this migration's transaction.
--
-- REVERSE (loses only the tombstones written into it):
--   DROP VIEW IF EXISTS claude_ro.oura_workouts; ALTER TABLE oura_workouts DROP COLUMN deleted_at;
--   (the view selects the column, so the DROP COLUMN fails without the DROP VIEW; the boot rebuild recreates the view from claude-ro-views.sql)

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE oura_workouts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
