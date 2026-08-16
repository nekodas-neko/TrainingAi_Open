-- Q-6: clear the temperature deviations taken against a baseline that had not warmed up.
--
-- `updateBaseline` (lib/health/personal-baseline.ts) is a faithful port of ecore's
-- `baseline_update_lt_mean_and_dev` and starts from meanX8 = 0. That is correct for the ring, which
-- carries its own accrued state, but our fold cold-started on 2026-07-07 — so the mean climbs from
-- zero over roughly three weeks and any deviation taken against it is nonsense. Production held
-- temp_dev_c = +17.000 degC on 2026-07-09, decaying to +0.038 by 2026-07-27.
--
-- That number was not cosmetic: it went verbatim into the AI health-insight prompt
-- ("Body temp deviation ... +17.0degC") and onto the day-log surface. The illness radar and the
-- readiness composite already gate on BASELINE_MIN_NIGHTS = 14; temp_dev_c did not.
--
-- Owner decision (2026-07-27): keep the pinned port exactly as it is and suppress the derived
-- deviation until the baseline is mature. `computeDailySummaries` now emits NULL below 14 nights,
-- so a replay produces these same NULLs; this migration corrects the rows already stored.
--
-- Idempotent: re-running matches nothing, because the predicate requires a non-NULL value.
-- Only temp_dev_c is affected — the baseline state columns are the fold's own checkpoint and must
-- keep their values, or resuming from a checkpoint would no longer reproduce a full replay.

UPDATE oura_daily_summary
SET temp_dev_c = NULL
WHERE n_history < 14
  AND temp_dev_c IS NOT NULL;
