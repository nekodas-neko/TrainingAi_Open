-- #3044, #2843: a Health Connect exercise session's own id and source on activity_logs, and a
-- strength activity type.
--
-- Today a Health Connect session reaches activity_logs with no record id and no source, so it is
-- de-duplicated on its date and HH:MM only: an edit whose start moved is stored a second time, a
-- deleted session never leaves, and a watch session and an in-app log at the same minute both
-- count. These two columns let a writer key the row on the record id Health Connect gives it
-- (`metadata.id`) and the source that sent it, update it in place, and tombstone it (`deleted_at`
-- is already on the table) when it is deleted there. Watch strength sessions map to `strength`,
-- which had no row, so they were stored as `other` at the generic cardio rate.
--
-- Shipped alone, before the code that writes and reads it (CLAUDE.md: a migration never rides in a
-- batch with anything else). Until that code lands nothing writes the columns, every row has them
-- NULL, and the `date|HH:MM` rule goes on as today.
--
-- Additive only: two nullable columns with no default (catalog-only, no rewrite), one partial unique
-- index that no existing row is in (every row's external_id is NULL), and one activity type row. No
-- existing row is changed, backfilled or deleted.
--
-- Guards: `lock_timeout` so a long reader on activity_logs makes this give up (and ensureSchema
-- retry it on the next boot) rather than queue writers behind it; `statement_timeout` as a
-- backstop. Both are SET LOCAL, scoped to this migration's transaction. The index is built on an
-- empty predicate, so it is quick without CONCURRENTLY.
--
-- REVERSE (loses only what later code writes into the columns; reassign any `strength` rows first):
--   DROP INDEX IF EXISTS activity_logs_external_idx;
--   ALTER TABLE activity_logs DROP COLUMN external_id, DROP COLUMN external_source;
--   DELETE FROM activity_types WHERE id = 'strength';

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS external_source TEXT;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS activity_logs_external_idx
  ON activity_logs (user_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

INSERT INTO activity_types (id, label, icon, is_distance_based, sort_order)
VALUES ('strength', 'Strength', 'Barbell', false, 10)
ON CONFLICT (id) DO NOTHING;
