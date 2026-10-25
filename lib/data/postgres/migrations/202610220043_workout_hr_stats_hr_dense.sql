-- #3150: store the #2437 density verdict with each workout's HR snapshot.
--
-- The calorie gate (`getAvgBpmBySession`) drops a session's stored `avg_bpm` back to the MET
-- estimate when every in-session reading came from Health Connect or Apple Health and the series is
-- too sparse to average. It judges that from `oura_heartrate`, which is pruned at 180 days; once the
-- series is gone it has nothing to read and keeps the average, so a sparse gated session's calories
-- would switch from METs to the HR estimate half a year after it was logged. `hr_dense` will hold
-- the gate's verdict, frozen by the prune just before it deletes the session's series, and the gate
-- will read it from then on.
--
-- Shipped alone, before the code that writes and reads it (CLAUDE.md: a migration never rides in a
-- batch with anything else; #3147, #3160 and #2983 did the same). Until that code lands nothing
-- sets the column, every row has it NULL, and the gate goes on as today.
--
-- Not entirely inert while it is missing: Drizzle's INSERT names every schema column, sending
-- `default` for the ones it is not given, so once `schema.ts` names `hr_dense`,
-- `upsertWorkoutHrStats` names it too. If this migration fails (say its 3 s lock timeout) the boot
-- still serves (`ensureSchema` logs and goes on), and workout HR snapshot writes fail with 42703
-- until it applies on a later boot. Reads are unaffected. Accepted: the table is small (one row per
-- workout), the timeout is unlikely on it, a failed snapshot write is fire-and-forget and recomputed
-- on the next recap view, and the next boot retries the migration.
--
-- Additive only: one nullable column with no default (catalog-only, no rewrite). No existing row is
-- changed, backfilled or deleted.
--
-- Guards: `lock_timeout` so a long reader on workout_hr_stats makes this give up (and ensureSchema
-- retry it on the next boot) rather than queue writers behind it; `statement_timeout` as a
-- backstop. Both are SET LOCAL, scoped to this migration's transaction.
--
-- REVERSE (loses only what later code writes into the column; drop that code first). The claude_ro
-- view names the column, so it goes first; the boot rebuild recreates the views (#3246):
--   DROP VIEW IF EXISTS claude_ro.workout_hr_stats;
--   ALTER TABLE workout_hr_stats DROP COLUMN hr_dense;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE workout_hr_stats ADD COLUMN IF NOT EXISTS hr_dense BOOLEAN;
