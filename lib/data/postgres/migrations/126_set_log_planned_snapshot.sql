-- Snapshot the PLANNED per-set target (pct + rest) onto each set_logs row at log time,
-- so the plan-vs-actual delta stays queryable after the program/style is later edited.
-- Nullable: historical rows, freeform logs, and the legacy bulk-sync path carry no plan.
ALTER TABLE set_logs ADD COLUMN IF NOT EXISTS planned_pct      double precision;
ALTER TABLE set_logs ADD COLUMN IF NOT EXISTS planned_rest_sec integer;
