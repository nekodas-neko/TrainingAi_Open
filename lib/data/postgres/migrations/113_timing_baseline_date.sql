-- Workout timing fidelity chunk 2: a user-set "first viable day" for the admin
-- Time Audit + planning averages. Null (default) means no lower bound — behaves
-- exactly as today.
ALTER TABLE users ADD COLUMN IF NOT EXISTS timing_baseline_date date;
