-- programs.started_at was never written by the application — saveProgram only
-- persists phase_mode/sessions_per_cycle/phase_set_id, so every automatic-mode
-- program had started_at = NULL. Both /api/workout-data and /api/log-exercise
-- fall back to "today" when started_at is null, which resets the block-cycle
-- reference point every day: countSessionsSinceStart then only counts today's
-- sessions, completedCycles never advances past 0, and phase calculation is
-- permanently pinned to the first phase (Baseline/Testing).
UPDATE programs
SET started_at = (now() AT TIME ZONE 'Australia/Brisbane')::date
WHERE phase_mode = 'automatic' AND started_at IS NULL;
