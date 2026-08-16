-- Migration 066 only relinked an orphaned workout_sessions row when its
-- session_name was unique across ALL of a user's programs — including old,
-- inactive programs left over from earlier iterations. Users who reused
-- common session names (e.g. "Push") across an old program and their current
-- one were skipped entirely. Retry the same relink, but scope both the match
-- and the uniqueness check to the user's currently active program, where a
-- name collision is far less likely and the match is unambiguous.
UPDATE workout_sessions ws
SET session_id = ps.id
FROM program_sessions ps
JOIN programs p ON p.id = ps.program_id
WHERE ws.session_id IS NULL
  AND p.user_id = ws.user_id
  AND p.is_active = true
  AND ps.name = ws.session_name
  AND NOT EXISTS (
    SELECT 1 FROM program_sessions ps2
    WHERE ps2.program_id = ps.program_id AND ps2.name = ps.name AND ps2.id <> ps.id
  );
