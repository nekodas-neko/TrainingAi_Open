-- #3309: why an activity_logs row was tombstoned.
--
-- A tombstone (`deleted_at`) is set by two different things: the owner deleting a workout in the
-- app, and the Health Connect sweep tombstoning a session Health Connect no longer returns. Both
-- look the same, so `upsertHealthConnectActivityLog` has to treat every tombstoned id as deleted
-- for good, and a workout swept by mistake (or restored in Health Connect under the same id) can
-- never come back. This column records the cause: 'app' or 'health_connect_sweep'. The code that
-- writes and reads it follows in a separate PR.
--
-- Shipped alone (CLAUDE.md: a migration never rides in a batch with anything else). 0 rows change:
-- one nullable column, no default, no backfill, so every existing tombstone reads NULL and is
-- treated as an app delete.
--
-- Additive only and catalog-only (no table rewrite). Guards: `lock_timeout` so a long reader on
-- activity_logs makes this give up (and ensureSchema retry on the next boot) rather than queue
-- writers behind it; `statement_timeout` as a backstop. Both are SET LOCAL.
--
-- REVERSE (loses only what later code writes into the column):
--   DROP VIEW IF EXISTS claude_ro.activity_logs; ALTER TABLE activity_logs DROP COLUMN deleted_reason;
--   (the view selects the column, so the DROP COLUMN fails without the DROP VIEW; the boot rebuild recreates the view from claude-ro-views.sql)

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS deleted_reason TEXT;
