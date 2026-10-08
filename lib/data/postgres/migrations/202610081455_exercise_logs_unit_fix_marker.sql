-- issue 2383 (item 2) — Fix lbs logged as kg > Apply can only convert a log once: a marker column.
--
-- `applyLbsToKgFix` multiplies stored set weights, 1RM, target80 and volume by 0.45359237. Nothing
-- recorded that a log had been converted, so pressing Apply a second time over the same exercises
-- and date converted the same logs again (weights x 0.4536 squared). The marker lives on
-- the log itself, not in a separate table: it travels with the row, and the fix reads and writes it in
-- the same statement that rewrites the log.
--
-- What this does: ADD COLUMN unit_fix_applied_at timestamptz NULL on exercise_logs. Nullable, no
-- default: a catalog-only change, no table rewrite, every existing row reads NULL ("not converted").
-- No row is changed, backfilled or deleted. A log converted BEFORE this column existed cannot be
-- told apart from an unconverted one by any data we hold, so it stays NULL; the owner has to know
-- whether the fix was ever applied to it.
--
-- Guards: `lock_timeout` so a long reader holding the table makes this give up (and ensureSchema
-- retry it on the next boot) rather than queue every exercise-log write behind it; `statement_timeout`
-- as a backstop. Both are SET LOCAL, scoped to this migration's transaction.
--
-- Replay-safe (CI truncates schema_migrations and re-runs everything): ADD COLUMN IF NOT EXISTS.
--
-- REVERSE (loses only the marker, no weight data): ALTER TABLE exercise_logs DROP COLUMN unit_fix_applied_at;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE exercise_logs ADD COLUMN IF NOT EXISTS unit_fix_applied_at timestamptz;
