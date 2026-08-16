-- 146_backfill_completed_workouts.sql
--
-- Audit finding Q-8. `user_stats` counted every session that carried a log, finished or not, so
-- ~26% of the owner's displayed lifetime volume came from workouts with no `completed_at`. The
-- owner's call is that only finished workouts should count — but filtering on `completed_at` alone
-- would have silently deleted real training: of 28 unfinished sessions in production, **14 carry a
-- full 6-exercise / 18-set workout** and are all dated 2026-05-01 → 2026-06-21, i.e. before the
-- completion flow was reliable. The remainder are 12 empty shells (0 logs, several created the same
-- day as a real session, because the row is written when the screen opens) and 2 genuine partial
-- abandons with a single exercise.
--
-- So: stamp the historical finishers first, THEN count completed-only. Three or more logged
-- exercises is the separator — in production the finished sessions have 4/5/6 and the abandons have
-- 0 or 1, with nothing in between. `completed_at` is set to the session's own last log, never now(),
-- so a months-old workout is not re-dated into the present (which would fire phantom "new PR" and
-- streak events downstream).
--
-- Idempotent: only ever touches rows where `completed_at IS NULL`, so a re-run is a no-op.

UPDATE workout_sessions ws
SET completed_at = sub.last_logged_at
FROM (
  SELECT el.workout_session_id AS id, MAX(el.logged_at) AS last_logged_at
  FROM exercise_logs el
  WHERE el.deleted_at IS NULL
  GROUP BY el.workout_session_id
  HAVING COUNT(*) >= 3
) sub
WHERE ws.id = sub.id
  AND ws.completed_at IS NULL
  AND ws.deleted_at IS NULL;
