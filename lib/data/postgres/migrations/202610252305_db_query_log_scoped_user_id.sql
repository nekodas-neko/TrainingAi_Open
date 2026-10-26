-- #2119: which user's data a read-only query ran as.
--
-- /api/admin/db-query is about to accept a scoped user id, so the triaging agent can read the data
-- of a user who filed feedback. `db_query_log` records the sql, the ip and the timing of every
-- attempt but nothing about whose rows the query could see, so a read of another user's data would
-- leave no trace. This column is that trace: the user the claude_ro views were scoped to for the
-- query. NULL means the owner scope (the role default), which is every row written before this.
-- The code that writes and reads it follows in a separate PR.
--
-- Shipped alone (CLAUDE.md: a migration never rides in a batch with anything else). 0 rows change:
-- one nullable column, no default, no backfill. No foreign key on purpose: the log is an audit
-- trail and account deletion purges it explicitly (slices/account-deletion.ts), the same way it
-- already handles rows that merely name the user.
--
-- Additive only and catalog-only (no table rewrite). Guards: `lock_timeout` so a long reader on
-- db_query_log makes this give up (and ensureSchema retry on the next boot) rather than queue
-- writers behind it; `statement_timeout` as a backstop. Both are SET LOCAL.
--
-- REVERSE (loses only what later code writes into the column):
--   DROP VIEW IF EXISTS claude_ro.db_query_log; ALTER TABLE db_query_log DROP COLUMN scoped_user_id;
--   (the view selects the column, so the DROP COLUMN fails without the DROP VIEW; the boot rebuild recreates the view from claude-ro-views.sql)

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE db_query_log ADD COLUMN IF NOT EXISTS scoped_user_id UUID;
