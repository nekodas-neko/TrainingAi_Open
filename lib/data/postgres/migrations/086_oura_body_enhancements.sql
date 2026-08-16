-- Add active_calories column to body_metrics (calories burned from activity, from Oura).
-- Distinct from the existing `calories` column which tracks food calories consumed.
ALTER TABLE body_metrics
  ADD COLUMN IF NOT EXISTS active_calories INTEGER;
