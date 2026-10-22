-- #3150: store the #2437 density verdict with each workout's HR snapshot.
--
-- The calorie gate (`getAvgBpmBySession`) drops a session's stored `avg_bpm` back to the MET
-- estimate when every in-session reading came from Health Connect or Apple Health and the series is
-- too sparse to average. It judges that from `oura_heartrate`, which is pruned at 180 days; once the
-- series is gone it has nothing to read and keeps the average, so a sparse gated session's calories
-- would switch from METs to the HR estimate half a year after it was logged. `hr_dense` records the
-- verdict when the snapshot is computed (`computeWorkoutHr`), and the gate reads it once the series
-- has been pruned.
--
-- Shipped alone (CLAUDE.md: a migration never rides in a batch with anything else), with the code
-- that writes and reads it. NULL means "never judged": every existing row starts NULL, and the gate
-- treats NULL exactly as it does today (the average stands). A row gains a verdict the next time its
-- snapshot is recomputed while its series is still stored. Today no past session is gated, so no
-- past session's calories move.
--
-- Additive only: one nullable column with no default (catalog-only, no rewrite). No existing row is
-- changed, backfilled or deleted.
--
-- Guards: `lock_timeout` so a long reader on workout_hr_stats makes this give up (and ensureSchema
-- retry it on the next boot) rather than queue writers behind it; `statement_timeout` as a
-- backstop. Both are SET LOCAL, scoped to this migration's transaction.
--
-- REVERSE (loses only the verdicts written since; the gate then keeps every pruned snapshot's
-- average, as before this change):
--   ALTER TABLE workout_hr_stats DROP COLUMN hr_dense;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE workout_hr_stats ADD COLUMN IF NOT EXISTS hr_dense BOOLEAN;
