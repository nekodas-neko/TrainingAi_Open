-- saveProgram used to delete and recreate every program_sessions row on each
-- config save, and workout_sessions.session_id -> program_sessions.id is ON
-- DELETE SET NULL. Every save before the adapter.ts fix severed the link from
-- already-logged workouts to their session, breaking "trained today" detection
-- on the workout-select screen. Relink orphaned rows to the current
-- program_sessions row with the matching name, but only when that name is
-- unique among the user's programs (avoids guessing when multiple sessions
-- share a name).
UPDATE workout_sessions ws
SET session_id = ps.id
FROM program_sessions ps
JOIN programs p ON p.id = ps.program_id
WHERE ws.session_id IS NULL
  AND p.user_id = ws.user_id
  AND ps.name = ws.session_name
  AND NOT EXISTS (
    SELECT 1 FROM program_sessions ps2
    JOIN programs p2 ON p2.id = ps2.program_id
    WHERE p2.user_id = ws.user_id AND ps2.name = ws.session_name AND ps2.id <> ps.id
  );
