-- Persists the per-exercise deload flag that shouldCountTowardPr already gates on at
-- log time, so a later PR reconcile (edit/delete elsewhere for the same exercise) can
-- honour the same gate instead of promoting a deloaded log's inflated 1RM.
ALTER TABLE exercise_logs ADD COLUMN IF NOT EXISTS exercise_deloaded BOOLEAN NOT NULL DEFAULT false;
