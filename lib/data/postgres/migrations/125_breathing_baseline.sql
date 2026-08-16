-- 125_breathing_baseline.sql
-- Respiratory-rate illness biomarker (data-efficiency review 2026-07-16 §1.2 / S4).
-- The rollup already computes a nightly breaths/min (median of per-epoch
-- breathingFromIbi rates) into sleep_sessions.respiratory_rate; this gives it a
-- personal baseline on oura_daily_summary, mirroring the five existing metrics
-- (116_oura_daily_summary_baselines.sql). breath_avg_rpm is this night's raw value;
-- the baseline is the same ×8 fixed-point asymmetric-EMA state, carried in rpm×10
-- sample units (integer-sample resolution, same trick as met ×10). Backfills for
-- all history on the next rollup pass — the summary table is a full replay from
-- oura_raw_samples, so the baseline matures in lockstep with n_history.
ALTER TABLE oura_daily_summary ADD COLUMN IF NOT EXISTS breath_avg_rpm          DOUBLE PRECISION;
ALTER TABLE oura_daily_summary ADD COLUMN IF NOT EXISTS breath_baseline_mean_x8 INTEGER;
ALTER TABLE oura_daily_summary ADD COLUMN IF NOT EXISTS breath_baseline_dev_x8  INTEGER;
