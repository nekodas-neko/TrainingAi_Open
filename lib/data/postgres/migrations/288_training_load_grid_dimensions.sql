-- LA-161 — record the two numbers the training-load gate actually evaluated.
--
-- `training_load_gate` has read `insufficient_met` on days whose stored frames replay to a
-- 1421-minute grid with 1073 valid minutes, against floors of 720 and 360 (TN-79). One of those
-- two readings is wrong and nothing persisted says which, so the difference has been argued from
-- inference for five weeks. These are the inputs to `metsPerMinute.length < 720 || validMin < 360`
-- as `computeTrainingStress` saw them, so one day of production ends the question.
--
-- Nullable and additive: old rows stay NULL, and NULL keeps meaning "this was never recorded".
ALTER TABLE oura_daily_derived ADD COLUMN IF NOT EXISTS training_load_grid_len INTEGER;
ALTER TABLE oura_daily_derived ADD COLUMN IF NOT EXISTS training_load_valid_min INTEGER;
