-- issue 2399 — four lifts from the 2026-08-13 "Upper" session were a stale deload, but stored as full
-- effort, and two of them still hold the all-time best.
--
-- Session 812fffde-0be9-408e-8612-cd56f4ef9ca2 started 2026-08-13 22:28 UTC (08-14 Brisbane). Four of
-- its lifts ran at a planned 52% left over from the previous deload week (Q-229: the prescription's
-- expiry was stored and never checked, fixed by #1359; the style-less override gap by #1814), yet each
-- row stored `exercise_deloaded = false`, so `shouldCountTowardPr` counted them. Read from production
-- by the Orchestrator on 2026-10-11:
--
--   exercise_logs.id                       lift                    stored e1RM
--   07115bca-c74f-4b22-9de9-af9575cb16af   Cable Pulldown          31.25
--   5c001cac-cc87-4b50-aacd-524a55ee5938   Barbell Overhead Press  57.75
--   6bcb61ba-0adc-423a-af07-6403658219c8   Barbell Skull Crusher   57.75   current best
--   2685de45-7952-4245-929f-8a70576e68a6   Cable Preacher Curl     19.25   current best
--
-- Incline Bench Press in the same session (e3022b01-…) was a real 83% and is not touched. The owner
-- decided on 2026-10-06: mark the four as deload. Nothing is deleted.
--
-- What this does:
--   1. Sets `exercise_deloaded = true` on exactly those four ids. `updated_at` moves (the
--      trg_set_updated_at trigger, and stated here too) so devices pull the corrected rows, and
--      `client_edited_at` is stamped with server time, as every server-side fix does since issue
--      2721, so a stale offline copy cannot push the old flag back over it. `estimated_1rm` is left
--      as stored: every reader of it already gates on the flag, and the number is the record of what
--      was lifted.
--   2. Re-derives the best for each lift whose `personal_records` row still holds one of those four
--      logs' values: Barbell Skull Crusher 57.75 -> 49.75 and Cable Preacher Curl 19.25 -> 18.75,
--      both from 2026-08-21. Cable Pulldown (36, 07-03) and Overhead Press (58, 08-21) hold bests from
--      other sessions, so they do not match and do not move.
--
-- The selection in step 2 is `reconcilePersonalRecord`'s (adapter.ts), which mirrors
-- `shouldCountTowardPr` / `isDeloadedForEstimate`: a positive estimate, not deleted, the exercise not
-- deloaded, and the session baseline or neither a deload phase nor an early deload (NULL phase_type
-- counts as not deload). The one addition is `shouldCountTowardPr`'s plausibility ceiling
-- (MAX_PLAUSIBLE_ONE_RM_KG = 600). Ties go to the earliest log, as in 163. A lift with no eligible log
-- left keeps its row: reconcile would delete it, and this migration deletes nothing.
--
-- Postgres gives a statement the snapshot from its own start, so step 2 is a separate statement: one
-- data-modifying CTE could not see step 1's flags.
--
-- Guards: step 1 matches only the four ids AND `exercise_deloaded = false`; step 2 only touches a
-- record whose value still equals one of those (now deloaded) logs' estimates. A replay changes no
-- row. `lock_timeout` so a long reader on exercise_logs makes this give up (ensureSchema retries it
-- on the next boot) rather than queue workout writes behind it; `statement_timeout` as a backstop.
-- Both are SET LOCAL, scoped to this migration's transaction. Adds no table or column, so
-- claude-ro-views.sql does not change.
--
-- REVERSE (take the four estimates and the two old achieved_at values from the release-prep
-- snapshot):
--   UPDATE exercise_logs SET exercise_deloaded = false, updated_at = now(), client_edited_at = now()
--   WHERE id IN ('07115bca-c74f-4b22-9de9-af9575cb16af', '5c001cac-cc87-4b50-aacd-524a55ee5938',
--                '6bcb61ba-0adc-423a-af07-6403658219c8', '2685de45-7952-4245-929f-8a70576e68a6');
--   UPDATE personal_records SET estimated_1rm = 57.75, achieved_at = <snapshot>
--   WHERE exercise_name = 'Barbell Skull Crusher' AND user_id = <owner>;
--   UPDATE personal_records SET estimated_1rm = 19.25, achieved_at = <snapshot>
--   WHERE exercise_name = 'Cable Preacher Curl' AND user_id = <owner>;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ── 1. Mark the four logs as the deload they were ───────────────────────────────────────────────
UPDATE exercise_logs
SET exercise_deloaded = true,
    updated_at = now(),
    client_edited_at = now()
WHERE id IN (
    '07115bca-c74f-4b22-9de9-af9575cb16af',
    '5c001cac-cc87-4b50-aacd-524a55ee5938',
    '6bcb61ba-0adc-423a-af07-6403658219c8',
    '2685de45-7952-4245-929f-8a70576e68a6'
  )
  AND workout_session_id = '812fffde-0be9-408e-8612-cd56f4ef9ca2'
  AND exercise_deloaded = false;

-- ── 2. Re-derive the bests those logs were holding ──────────────────────────────────────────────
WITH stale AS (
  -- The records still pointing at one of the four logs' values. Empty on a replay, because the
  -- record no longer equals them.
  SELECT pr.id AS pr_id, ws.user_id, el.exercise_name
  FROM exercise_logs el
  JOIN workout_sessions ws ON ws.id = el.workout_session_id
  JOIN personal_records pr ON pr.user_id = ws.user_id AND pr.exercise_name = el.exercise_name
  WHERE el.id IN (
      '07115bca-c74f-4b22-9de9-af9575cb16af',
      '5c001cac-cc87-4b50-aacd-524a55ee5938',
      '6bcb61ba-0adc-423a-af07-6403658219c8',
      '2685de45-7952-4245-929f-8a70576e68a6'
    )
    AND el.exercise_deloaded = true
    AND abs(pr.estimated_1rm - el.estimated_1rm) <= 0.005
),
best AS (
  SELECT DISTINCT ON (ws.user_id, el.exercise_name)
         ws.user_id, el.exercise_name, el.estimated_1rm, el.logged_at
  FROM exercise_logs el
  JOIN workout_sessions ws ON ws.id = el.workout_session_id
  JOIN stale st ON st.user_id = ws.user_id AND st.exercise_name = el.exercise_name
  WHERE el.deleted_at IS NULL
    AND ws.deleted_at IS NULL
    AND el.estimated_1rm > 0
    AND el.estimated_1rm <= 600
    AND el.exercise_deloaded = false
    AND (ws.phase_type = 'baseline'
         OR ((ws.phase_type IS NULL OR ws.phase_type <> 'deload') AND ws.is_early_deload = false))
  ORDER BY ws.user_id, el.exercise_name, el.estimated_1rm DESC, el.logged_at ASC
)
UPDATE personal_records pr
SET estimated_1rm = best.estimated_1rm,
    achieved_at   = best.logged_at
FROM stale
JOIN best ON best.user_id = stale.user_id AND best.exercise_name = stale.exercise_name
WHERE pr.id = stale.pr_id;
