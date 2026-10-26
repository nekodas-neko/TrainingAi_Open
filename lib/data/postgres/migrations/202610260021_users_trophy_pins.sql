-- #3125: the trophies a user pins, saved on their account so friends see them.
--
-- Today the pins live only in the phone's own storage and the profile route shows a friend the
-- three highest-XP unlocks instead, so the two can differ and a new phone starts with an empty case.
-- This column holds the pinned achievement ids, in pin order. NULL means nothing pinned yet, and the
-- profile route then falls back to the top three by XP. The code that writes and reads it follows
-- in a separate PR.
--
-- Shipped alone (CLAUDE.md: a migration never rides in a batch with anything else). 0 rows change:
-- one nullable column, no default, no backfill.
--
-- Additive only and catalog-only (no table rewrite). Guards: `lock_timeout` so a long reader on
-- users makes this give up (and ensureSchema retry on the next boot) rather than queue writers
-- behind it; `statement_timeout` as a backstop. Both are SET LOCAL.
--
-- REVERSE (loses only what later code writes into the column):
--   DROP VIEW IF EXISTS claude_ro.users; ALTER TABLE users DROP COLUMN trophy_pins;
--   (the view selects the column, so the DROP COLUMN fails without the DROP VIEW; the boot rebuild recreates the view from claude-ro-views.sql)

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE users ADD COLUMN IF NOT EXISTS trophy_pins TEXT[];
