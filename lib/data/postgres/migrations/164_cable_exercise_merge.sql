-- Q-5b follow-up: merge the two cable exercise groups the owner confirmed are the same movement.
--
-- Migration 163 deliberately left these alone. Unlike the three free-text misspellings it did
-- merge, both sides of each group here are real `exercise_library` entries and both were actively
-- logged — so collapsing them is a statement about what the movements ARE, which is the owner's
-- call and not something a data-hygiene migration should assume. Confirmed 2026-07-29:
--
--   Cable Lat Pulldown    ─┐
--   Straight Arm Pulldown ─┴─>  Cable Pulldown
--   Cable Crunch          ───>  Cable Crunch Abs
--
-- The surviving name in each group is the one the owner's ACTIVE program uses (`Shikai`: Upper →
-- Cable Pulldown, Lower → Cable Crunch Abs), not the tidiest spelling. Renaming to a name the
-- active program does not reference would split the history again on the very next session.
--
-- Predicted effect on production (measured, read-only, before writing):
--   Cable Pulldown    36.00 from 14 logs  (was 11 logs; absorbs Cable Lat Pulldown 28.5 + Straight
--                                          Arm Pulldown 34.5 — neither beats the surviving 36.00)
--   Cable Crunch Abs  39.75 from 16 logs  (was 15; absorbs Cable Crunch 37.75)
--   personal_records: 33 rows -> 30
--
-- Structure mirrors 163 exactly: generic over users, inert on a database without these rows,
-- idempotent, and the re-derive runs LAST over the merged history so the result is self-consistent
-- (a later `reconcilePersonalRecord` is a no-op rather than a silent re-split).
--
-- NOT done here: the merged-away `exercise_library` rows are left in place. That table is global,
-- not per-user, so removing a catalogue entry is a different decision with a different blast
-- radius. The consequence is that the old names remain selectable in the exercise picker.

-- ── 1. Preserve anything the logs cannot account for ─────────────────────────
-- Same reasoning as 163 step 1: a value no log supports is a number the user typed, and the merge
-- must not be the thing that deletes it. Runs before any row moves.
WITH best AS (
  SELECT DISTINCT ON (ws.user_id, el.exercise_name)
         ws.user_id, el.exercise_name, el.estimated_1rm
  FROM exercise_logs el
  JOIN workout_sessions ws ON ws.id = el.workout_session_id
  WHERE el.deleted_at IS NULL
    AND ws.deleted_at IS NULL
    AND el.estimated_1rm > 0
    AND el.exercise_deloaded = false
    AND (ws.phase_type = 'baseline'
         OR ((ws.phase_type IS NULL OR ws.phase_type <> 'deload') AND ws.is_early_deload = false))
  ORDER BY ws.user_id, el.exercise_name, el.estimated_1rm DESC, el.logged_at ASC
)
INSERT INTO exercise_estimates (user_id, exercise_id, exercise_name, estimated_1rm)
SELECT pr.user_id, pr.exercise_id, pr.exercise_name, pr.estimated_1rm
FROM personal_records pr
LEFT JOIN best b ON b.user_id = pr.user_id AND b.exercise_name = pr.exercise_name
WHERE pr.exercise_name IN ('Cable Lat Pulldown', 'Straight Arm Pulldown', 'Cable Crunch')
  AND (b.estimated_1rm IS NULL OR pr.estimated_1rm > b.estimated_1rm + 0.005)
ON CONFLICT (user_id, exercise_name) DO NOTHING;

-- ── 2. Move the history onto the surviving name ──────────────────────────────
UPDATE exercise_logs el
SET exercise_name = p.canonical,
    exercise_id   = lib.id,
    updated_at    = now()
FROM (VALUES
  ('Cable Lat Pulldown',    'Cable Pulldown'),
  ('Straight Arm Pulldown', 'Cable Pulldown'),
  ('Cable Crunch',          'Cable Crunch Abs')
) AS p(variant, canonical)
LEFT JOIN exercise_library lib ON lib.name = p.canonical
WHERE el.exercise_name = p.variant;

UPDATE set_hr_stats sh
SET exercise_name = p.canonical
FROM (VALUES
  ('Cable Lat Pulldown',    'Cable Pulldown'),
  ('Straight Arm Pulldown', 'Cable Pulldown'),
  ('Cable Crunch',          'Cable Crunch Abs')
) AS p(variant, canonical)
WHERE sh.exercise_name = p.variant;

-- Archived programs too, so reactivating one cannot re-open the split. Skipped where the session
-- already carries the surviving name, which would collide.
UPDATE session_exercises se
SET exercise_name = p.canonical,
    exercise_id   = lib.id,
    updated_at    = now()
FROM (VALUES
  ('Cable Lat Pulldown',    'Cable Pulldown'),
  ('Straight Arm Pulldown', 'Cable Pulldown'),
  ('Cable Crunch',          'Cable Crunch Abs')
) AS p(variant, canonical)
LEFT JOIN exercise_library lib ON lib.name = p.canonical
WHERE se.id IN (
  -- Exactly one row per (session, canonical): two variants map onto `Cable Pulldown`, so a blind
  -- rename would collide them with each other, not just with an existing canonical row.
  SELECT DISTINCT ON (x.session_id, q.canonical) x.id
  FROM session_exercises x
  JOIN (VALUES
    ('Cable Lat Pulldown',    'Cable Pulldown'),
    ('Straight Arm Pulldown', 'Cable Pulldown'),
    ('Cable Crunch',          'Cable Crunch Abs')
  ) AS q(variant, canonical) ON q.variant = x.exercise_name
  WHERE NOT EXISTS (
    SELECT 1 FROM session_exercises c
    WHERE c.session_id = x.session_id AND c.exercise_name = q.canonical
  )
  ORDER BY x.session_id, q.canonical, x.position
) AND se.exercise_name = p.variant;

-- ── 3. Fold the personal_records rows together ───────────────────────────────
--
-- Order matters, and it is not the obvious one. TWO variants map onto `Cable Pulldown`, so:
--   (a) rename EXACTLY ONE orphan variant per (user, canonical) — a blind rename collides the two
--       variants with each other on the (user_id, exercise_name) unique key, not just with an
--       existing canonical row, which aborts the whole migration;
--   (b) only THEN raise, so the second variant is compared against the survivor the rename just
--       created rather than being deleted without ever being considered.

-- (a) A user who only ever logged a variant has no survivor row to fold into: rename rather than
-- delete, or the merge destroys their only record for the movement.
UPDATE personal_records v
SET exercise_name = p.canonical,
    exercise_id   = lib.id
FROM (VALUES
  ('Cable Lat Pulldown',    'Cable Pulldown'),
  ('Straight Arm Pulldown', 'Cable Pulldown'),
  ('Cable Crunch',          'Cable Crunch Abs')
) AS p(variant, canonical)
LEFT JOIN exercise_library lib ON lib.name = p.canonical
WHERE v.exercise_name = p.variant
  AND v.id IN (
    -- Highest-valued variant wins the rename; the rest fall through to (b) and (c) below.
    SELECT DISTINCT ON (x.user_id, q.canonical) x.id
    FROM personal_records x
    JOIN (VALUES
      ('Cable Lat Pulldown',    'Cable Pulldown'),
      ('Straight Arm Pulldown', 'Cable Pulldown'),
      ('Cable Crunch',          'Cable Crunch Abs')
    ) AS q(variant, canonical) ON q.variant = x.exercise_name
    WHERE NOT EXISTS (
      SELECT 1 FROM personal_records c
      WHERE c.user_id = x.user_id AND c.exercise_name = q.canonical
    )
    ORDER BY x.user_id, q.canonical, x.estimated_1rm DESC
  );

-- (b) Raise the survivor if a remaining variant held the better number. (In the audited data none
-- do — 36.00 and 39.75 both survive — but a merge that could silently lower a best is not one
-- worth shipping.)
UPDATE personal_records c
SET estimated_1rm = v.estimated_1rm,
    achieved_at   = v.achieved_at
FROM (VALUES
  ('Cable Lat Pulldown',    'Cable Pulldown'),
  ('Straight Arm Pulldown', 'Cable Pulldown'),
  ('Cable Crunch',          'Cable Crunch Abs')
) AS p(variant, canonical)
JOIN personal_records v ON v.exercise_name = p.variant
WHERE c.exercise_name = p.canonical
  AND c.user_id = v.user_id
  AND v.estimated_1rm > c.estimated_1rm + 0.005;

-- (c) Whatever still carries a variant name is now redundant with a survivor >= it.
DELETE FROM personal_records v
USING (VALUES
  ('Cable Lat Pulldown',    'Cable Pulldown'),
  ('Straight Arm Pulldown', 'Cable Pulldown'),
  ('Cable Crunch',          'Cable Crunch Abs')
) AS p(variant, canonical)
WHERE v.exercise_name = p.variant;

-- Keep exercise_estimates in step, including anything step 1 just preserved under a variant name.
-- Same one-row-per-(user, canonical) restriction, for the same reason.
UPDATE exercise_estimates e
SET exercise_name = p.canonical,
    exercise_id   = lib.id,
    updated_at    = now()
FROM (VALUES
  ('Cable Lat Pulldown',    'Cable Pulldown'),
  ('Straight Arm Pulldown', 'Cable Pulldown'),
  ('Cable Crunch',          'Cable Crunch Abs')
) AS p(variant, canonical)
LEFT JOIN exercise_library lib ON lib.name = p.canonical
WHERE e.exercise_name = p.variant
  AND e.id IN (
    SELECT DISTINCT ON (x.user_id, q.canonical) x.id
    FROM exercise_estimates x
    JOIN (VALUES
      ('Cable Lat Pulldown',    'Cable Pulldown'),
      ('Straight Arm Pulldown', 'Cable Pulldown'),
      ('Cable Crunch',          'Cable Crunch Abs')
    ) AS q(variant, canonical) ON q.variant = x.exercise_name
    WHERE NOT EXISTS (
      SELECT 1 FROM exercise_estimates c
      WHERE c.user_id = x.user_id AND c.exercise_name = q.canonical
    )
    ORDER BY x.user_id, q.canonical, x.estimated_1rm DESC
  );

DELETE FROM exercise_estimates e
USING (VALUES
  ('Cable Lat Pulldown',    'Cable Pulldown'),
  ('Straight Arm Pulldown', 'Cable Pulldown'),
  ('Cable Crunch',          'Cable Crunch Abs')
) AS p(variant, canonical)
WHERE e.exercise_name = p.variant;

-- ── 4. Re-derive the two survivors over the merged history ───────────────────
-- Scoped to the two surviving names: 163 already reconciled everything else, and re-running the
-- whole table would re-stamp `achieved_at` on rows this migration has no business touching.
WITH best AS (
  SELECT DISTINCT ON (ws.user_id, el.exercise_name)
         ws.user_id, el.exercise_name, el.estimated_1rm, el.logged_at
  FROM exercise_logs el
  JOIN workout_sessions ws ON ws.id = el.workout_session_id
  WHERE el.deleted_at IS NULL
    AND ws.deleted_at IS NULL
    AND el.estimated_1rm > 0
    AND el.exercise_deloaded = false
    AND (ws.phase_type = 'baseline'
         OR ((ws.phase_type IS NULL OR ws.phase_type <> 'deload') AND ws.is_early_deload = false))
    AND el.exercise_name IN ('Cable Pulldown', 'Cable Crunch Abs')
  ORDER BY ws.user_id, el.exercise_name, el.estimated_1rm DESC, el.logged_at ASC
)
UPDATE personal_records pr
SET estimated_1rm = best.estimated_1rm,
    achieved_at   = best.logged_at
FROM best
WHERE pr.user_id = best.user_id
  AND pr.exercise_name = best.exercise_name
  AND (abs(pr.estimated_1rm - best.estimated_1rm) > 0.005
       OR pr.achieved_at::date <> best.logged_at::date);
