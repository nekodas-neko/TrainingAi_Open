-- Exercises sharing a non-null group value within a session alternate as a superset.
ALTER TABLE session_exercises ADD COLUMN IF NOT EXISTS superset_group SMALLINT;
