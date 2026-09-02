-- Q-510: persist how much daytime stress coverage a day actually had.
--
-- `final_check_stress_coverage` in the resilience model is
--   `resolutionMinutes × nonNaN_resampled_buckets >= minDaytimeStressHours × 60`
-- and NEITHER SIDE was stored anywhere. `minDaytimeStressHours` is a vendored constant and the
-- bucket count was computed inside `preprocessStress` and discarded, so "why did resilience produce
-- nothing today" could not be answered from data at all — measured 2026-08-18, a daily index landed
-- on 3 of 18 days while all four `contributorsOk` inputs passed on every one of them.
--
-- The stored extreme-bucket counts cannot stand in for it: 08-07, 08-13 and 08-17 each carry 90
-- minutes of extremes and produce no index, while 08-16 carries the same 90 and does.
--
-- Nullable and additive, so this is reversible by dropping the column; nothing reads it yet.
-- NULL keeps its own meaning — see the model's `daytimeStressCoverageMin`: it is "not evaluated"
-- (a contributor was missing, so the model was fed an empty series and a 0 here would be an
-- artefact of that gating), never "zero coverage".
ALTER TABLE oura_daily_derived
  ADD COLUMN IF NOT EXISTS daytime_stress_coverage_min DOUBLE PRECISION;
