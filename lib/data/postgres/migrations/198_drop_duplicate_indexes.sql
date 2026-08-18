-- Q-550: seven pairs of byte-identical indexes; drop one of each. ~10 MB, no behaviour change.
--
-- Each index dropped here has a sibling on the same table with the SAME columns, the SAME sort
-- options and the SAME (absent) partial predicate — so the planner can serve from the survivor
-- anything it served from the dropped one. This is a structural claim, not a usage one: it does not
-- depend on `idx_scan`, which is the right way round, because the counters were reset by the
-- 2026-08-17 crash recovery and a fresh zero means "not since then", not "never".
--
-- Measured against production 2026-08-18 by comparing pg_index.indkey, indoption and indpred.
--
--   dropped                             size   survivor                                   why the survivor
--   oura_heartrate_user_ts            7696 kB  oura_heartrate_user_id_timestamp_key       enforces a constraint
--   rr_intervals_user_at              2464 kB  rr_intervals_user_id_at_key                enforces a constraint
--   idx_body_metrics_user_date          40 kB  idx_bm_user_date                           001 lineage, maintained by 174
--   idx_workout_sessions_user_started   16 kB  idx_ws_user_started                        001 lineage, maintained by 002
--   idx_ps_program_pos                  16 kB  program_sessions_program_id_position_key   enforces a constraint
--   idx_body_battery_daily_user_date    16 kB  body_battery_daily_user_id_date_key        enforces a constraint
--   coach_messages_thread_position_idx  16 kB  coach_messages_thread_id_position_key      enforces a constraint
--
-- Where the pair is unique/non-unique the unique one survives — it backs a constraint and cannot be
-- dropped anyway. Where both are plain (body_metrics, workout_sessions) the 001-lineage name
-- survives, because later migrations still maintain it: 174 recreates idx_bm_user_date and 002
-- recreates idx_ws_user_started, while nothing has touched 087's copies since it added them.
--
-- 087_composite_indexes.sql is where those two came from, and its own comment shows how it happened:
-- *"body_metrics: user data sorted by date (separate from unique(user_id,date) which has no DESC)"*.
-- That reasoning is sound — a DESC index is genuinely not the same as the ASC unique one — but the
-- DESC index it wanted already existed, created by 001_initial. It duplicated 001, not the
-- constraint. Two of 087's four statements were already-present indexes.
--
-- FIVE indexes are deliberately NOT dropped even though they cover the same columns as a unique
-- index: idx_bm_user_date, idx_oura_daily_user_date, oura_daily_summary_user_date_idx,
-- oura_daily_derived_user_day_idx and the surviving body_metrics one all carry DESC on their second
-- column where the unique index is ASC. Backward scanning does work — the local EXPLAIN for
-- `ORDER BY at DESC` on rr_intervals picks "Index Scan Backward" off the ASC unique index — so the
-- argument for dropping them is probably sound. It is not that it fails; it is that the five are
-- **128 kB combined**, so proving it properly buys a rounding error. Left in place deliberately.
-- If someone revisits this, the work is an EXPLAIN per read path, not a repeat of this analysis.
--
-- Reversible: every drop is one CREATE INDEX away, and the definitions are in the migrations named
-- above. No data is touched.

DROP INDEX IF EXISTS oura_heartrate_user_ts;
DROP INDEX IF EXISTS rr_intervals_user_at;
DROP INDEX IF EXISTS idx_body_metrics_user_date;
DROP INDEX IF EXISTS idx_workout_sessions_user_started;
DROP INDEX IF EXISTS idx_ps_program_pos;
DROP INDEX IF EXISTS idx_body_battery_daily_user_date;
DROP INDEX IF EXISTS coach_messages_thread_position_idx;
