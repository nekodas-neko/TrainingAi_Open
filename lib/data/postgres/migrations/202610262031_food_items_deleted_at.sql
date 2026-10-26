-- #2417: a tombstone for `food_items`, so look-alike foods can be merged without a hard delete.
--
-- Owner decision, 2026-10-09: the 41 look-alike groups in My Foods are merged by re-pointing their
-- logs to one keeper and retiring the rest. `food_items` has no delete path today, and a hard delete
-- is invisible to a device that has not synced (docs/rules/offline-first-and-storage.md), so a
-- retired row carries `deleted_at` instead. `food_logs.food_item_id` and
-- `saved_meal_items.food_item_id` are NO ACTION foreign keys, so the row has to stay for any log
-- from an unsynced device that still points at it.
--
-- This column is the whole migration. Nothing reads it yet: the list routes, the pull and the merge
-- job follow in their own PR, and no row is marked here. Every existing row stays NULL, which means
-- "live".
--
-- Shipped alone (CLAUDE.md: a migration never rides in a batch with anything else).
--
-- Additive only: one nullable column with no default (catalog-only, no rewrite). No existing row is
-- changed, backfilled or deleted.
--
-- Guards: `lock_timeout` so a long reader on food_items makes this give up (and ensureSchema retry
-- it on the next boot) rather than queue food logging behind it; `statement_timeout` as a backstop.
-- Both are SET LOCAL, scoped to this migration's transaction.
--
-- REVERSE (loses only the tombstones recorded since). The claude_ro view lists columns explicitly,
-- so it has to go first or the column drop is refused (#3263); the next boot rebuilds it:
--   DROP VIEW IF EXISTS claude_ro.food_items;
--   ALTER TABLE food_items DROP COLUMN deleted_at;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE food_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
