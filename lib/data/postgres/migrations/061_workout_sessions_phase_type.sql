ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS phase_type text;

-- Backfill existing rows from the program_phases row their phase_id currently
-- points at. After this runs once, phase_type becomes a permanent write-time
-- snapshot — independent of whether the program_phases/phase_sets rows are
-- later deleted.
UPDATE workout_sessions ws
SET phase_type = pp.phase_type
FROM program_phases pp
WHERE ws.phase_id = pp.id
  AND ws.phase_type IS NULL;
