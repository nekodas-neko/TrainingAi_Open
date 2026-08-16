-- Q-5b: make `personal_records` say what it claims to say.
--
-- Q-5's structural half (migration 159) split the two meanings the table had been serving: an
-- earned all-time best, and a starting 1RM the user typed into the builder. `exercise_estimates`
-- now holds the second. This migration is the data half — the part that rewrites existing rows,
-- held back until the owner confirmed it.
--
-- Audited against production before writing (read-only, `claude_ro`). 36 rows; six change:
--
--   Barbell Bench Press      92.75 -> 96.00   the best log (2026-05-21) was never promoted
--   Barbell Front Squat      67.50 -> 73.75   same
--   Dumbbell Hammer Curl     19.25 -> 15.75   no log supports 19.25
--   Straight Arm Pulldown    34.50 -> 32.50   no log supports 34.50
--   Tricep Cable Combo       33.25 -> 29.25   no log supports 33.25
--   Dumbbell Lateral Raise   16.75 -> 16.75   value right, `achieved_at` points at the wrong day
--
-- and three free-text duplicates are merged away (they are the only rows with a NULL
-- `exercise_id`, because their misspellings have no `exercise_library` entry to point at — so the
-- plan's "backfill exercise_id on all 36" resolves to nothing; the other 33 ids are already correct
-- and were verified against the library by name).
--
-- Everything below is expressed generically over users, not against one account, and every
-- statement is a no-op on a database that does not have these rows.
--
-- The 1RM formula is NOT restated here (One Formula, One Place). Only the *selection* is —
-- an aggregation over the `estimated_1rm` column the log path already wrote, whose gate mirrors
-- `reconcilePersonalRecord` (adapter.ts) exactly, the same way migration 148 did it.

-- ── 1. Preserve, before anything is corrected ────────────────────────────────
--
-- A `personal_records` value that no log can account for is, by elimination, a number the user
-- typed — a seeded starting 1RM from the era when the builder wrote them here. Correcting it away
-- without keeping it would delete a real user input, so it lands in `exercise_estimates` first.
-- `resolveWorkingBasis` takes the max across log / estimate / PR, so nothing regresses: the value
-- keeps doing its job from its proper home.
--
-- DO NOTHING on conflict: an estimate the user has since entered themselves is newer and wins.
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
  ORDER BY ws.user_id, el.exercise_name, el.estimated_1rm DESC, el.logged_at ASC
)
INSERT INTO exercise_estimates (user_id, exercise_id, exercise_name, estimated_1rm)
SELECT pr.user_id, pr.exercise_id, pr.exercise_name, pr.estimated_1rm
FROM personal_records pr
LEFT JOIN best b ON b.user_id = pr.user_id AND b.exercise_name = pr.exercise_name
WHERE b.estimated_1rm IS NULL OR pr.estimated_1rm > b.estimated_1rm + 0.005
ON CONFLICT (user_id, exercise_name) DO NOTHING;

-- ── 2. Merge the free-text duplicate names ───────────────────────────────────
--
-- Three exercises were logged under a misspelling before the library existed, then again under the
-- catalogue name, leaving two PR rows for one movement. Only these three are merged. The audit also
-- surfaced `Cable Pulldown`/`Cable Lat Pulldown` and `Cable Crunch`/`Cable Crunch Abs`, which the
-- original plan grouped with them — those are NOT merged here: both sides of each pair are distinct
-- `exercise_library` entries and both are actively logged, so collapsing them is a catalogue
-- decision about whether they are the same movement, not a data-hygiene fix. Left for the owner.
--
-- The variants' logs are renamed too, not just their PR row. A PR merge alone would leave the
-- table asserting a best that the logs under that name do not support, and the next
-- `reconcilePersonalRecord` call for the exercise would quietly undo the merge. Renaming makes the
-- merged value derivable, which is the whole point of the table after Q-5.
-- The pair list is repeated inline rather than held in a TEMP TABLE: a temp table's lifetime
-- depends on how the file is applied (one implicit transaction via `pool.query` in ensureSchema,
-- but statement-at-a-time under `psql -f`), and a migration must not behave differently depending
-- on who runs it.

-- Move the history onto the canonical name, and pick up the library id while we are here.
UPDATE exercise_logs el
SET exercise_name = p.canonical,
    exercise_id   = COALESCE(el.exercise_id, lib.id),
    updated_at    = now()
FROM (VALUES
  ('Dumbell Preacher Curl',  'Dumbbell Preacher Curl'),
  ('Dumbell Shoulder Press', 'Dumbbell Shoulder Press'),
  ('DB lateral Raises',      'Dumbbell Lateral Raise')
) AS p(variant, canonical)
LEFT JOIN exercise_library lib ON lib.name = p.canonical
WHERE el.exercise_name = p.variant;

UPDATE set_hr_stats sh
SET exercise_name = p.canonical
FROM (VALUES
  ('Dumbell Preacher Curl',  'Dumbbell Preacher Curl'),
  ('Dumbell Shoulder Press', 'Dumbbell Shoulder Press'),
  ('DB lateral Raises',      'Dumbbell Lateral Raise')
) AS p(variant, canonical)
WHERE sh.exercise_name = p.variant;

-- Archived programs too, so reactivating one cannot re-open the split.
UPDATE session_exercises se
SET exercise_name = p.canonical,
    exercise_id   = COALESCE(se.exercise_id, lib.id),
    updated_at    = now()
FROM (VALUES
  ('Dumbell Preacher Curl',  'Dumbbell Preacher Curl'),
  ('Dumbell Shoulder Press', 'Dumbbell Shoulder Press'),
  ('DB lateral Raises',      'Dumbbell Lateral Raise')
) AS p(variant, canonical)
LEFT JOIN exercise_library lib ON lib.name = p.canonical
WHERE se.exercise_name = p.variant
  -- A row already carrying the canonical name for the same session would collide on rename.
  AND NOT EXISTS (
    SELECT 1 FROM session_exercises c
    WHERE c.session_id = se.session_id AND c.exercise_name = p.canonical
  );

-- Raise the canonical PR if the variant held the better number. (In the audited data it never
-- does — the canonical value dominates all three — but a merge that could silently lower a user's
-- best is not a merge worth shipping.)
UPDATE personal_records c
SET estimated_1rm = v.estimated_1rm,
    achieved_at   = v.achieved_at
FROM (VALUES
  ('Dumbell Preacher Curl',  'Dumbbell Preacher Curl'),
  ('Dumbell Shoulder Press', 'Dumbbell Shoulder Press'),
  ('DB lateral Raises',      'Dumbbell Lateral Raise')
) AS p(variant, canonical)
JOIN personal_records v ON v.exercise_name = p.variant
WHERE c.exercise_name = p.canonical
  AND c.user_id = v.user_id
  AND v.estimated_1rm > c.estimated_1rm + 0.005;

-- A user who logged only under the misspelling has no canonical row to merge into: rename rather
-- than delete, or the merge would destroy their only record for the movement.
UPDATE personal_records v
SET exercise_name = p.canonical,
    exercise_id   = COALESCE(v.exercise_id, lib.id)
FROM (VALUES
  ('Dumbell Preacher Curl',  'Dumbbell Preacher Curl'),
  ('Dumbell Shoulder Press', 'Dumbbell Shoulder Press'),
  ('DB lateral Raises',      'Dumbbell Lateral Raise')
) AS p(variant, canonical)
LEFT JOIN exercise_library lib ON lib.name = p.canonical
WHERE v.exercise_name = p.variant
  AND NOT EXISTS (
    SELECT 1 FROM personal_records c
    WHERE c.user_id = v.user_id AND c.exercise_name = p.canonical
  );

-- Whatever variant rows remain are now strictly redundant with a canonical row that is >= them.
DELETE FROM personal_records v
USING (VALUES
  ('Dumbell Preacher Curl',  'Dumbbell Preacher Curl'),
  ('Dumbell Shoulder Press', 'Dumbbell Shoulder Press'),
  ('DB lateral Raises',      'Dumbbell Lateral Raise')
) AS p(variant, canonical)
WHERE v.exercise_name = p.variant;

-- Same for any estimate step 1 may have preserved under a variant name, so the two tables agree.
UPDATE exercise_estimates e
SET exercise_name = p.canonical,
    exercise_id   = COALESCE(e.exercise_id, lib.id),
    updated_at    = now()
FROM (VALUES
  ('Dumbell Preacher Curl',  'Dumbbell Preacher Curl'),
  ('Dumbell Shoulder Press', 'Dumbbell Shoulder Press'),
  ('DB lateral Raises',      'Dumbbell Lateral Raise')
) AS p(variant, canonical)
LEFT JOIN exercise_library lib ON lib.name = p.canonical
WHERE e.exercise_name = p.variant
  AND NOT EXISTS (
    SELECT 1 FROM exercise_estimates c
    WHERE c.user_id = e.user_id AND c.exercise_name = p.canonical
  );

DELETE FROM exercise_estimates e
USING (VALUES
  ('Dumbell Preacher Curl',  'Dumbbell Preacher Curl'),
  ('Dumbell Shoulder Press', 'Dumbbell Shoulder Press'),
  ('DB lateral Raises',      'Dumbbell Lateral Raise')
) AS p(variant, canonical)
WHERE e.exercise_name = p.variant;

-- ── 3. Re-derive every PR from the (now merged) logs ─────────────────────────
--
-- Runs last so it sees the unified history and leaves the table self-consistent: every surviving
-- row is exactly what `reconcilePersonalRecord` would produce, so a later reconcile is a no-op
-- rather than a silent re-drift.
--
-- `achieved_at` is only re-stamped when the value changes or when it points at a different
-- *day* than the log that earned it. 25 further rows differ by hours within the same day — the PR
-- was stamped at write time rather than log time — and rewriting those timestamps would be churn
-- on real records with nothing to show for it.
--
-- Rows with no surviving log are deliberately left alone rather than deleted. Step 1 has already
-- copied their value somewhere safe, and there are none in the audited data; shipping an
-- unexercised DELETE against real personal records to handle a case that does not occur is not a
-- trade worth making.
WITH best AS (
  -- Partitioned by user_id as well as exercise_name: a bare DISTINCT ON (exercise_name) would pick
  -- one row across ALL accounts and stamp it onto every user's PR for that movement.
  SELECT DISTINCT ON (ws.user_id, el.exercise_name)
         ws.user_id, el.exercise_name, el.estimated_1rm, el.logged_at
  FROM exercise_logs el
  JOIN workout_sessions ws ON ws.id = el.workout_session_id
  WHERE el.deleted_at IS NULL
    AND ws.deleted_at IS NULL
    AND el.estimated_1rm > 0
    -- Mirrors shouldCountTowardPr's per-exercise deload gate — unconditional, no baseline
    -- exception (the exercise itself was cut, unlike a whole-session deload).
    AND el.exercise_deloaded = false
    -- Mirrors log-exercise.ts's isAnyDeload gate exactly, including NULL phase_type (manual-mode
    -- programs never set it) counting as "not deload" — a plain <> against NULL is unknown in SQL
    -- and would wrongly exclude those rows.
    AND (ws.phase_type = 'baseline'
         OR ((ws.phase_type IS NULL OR ws.phase_type <> 'deload') AND ws.is_early_deload = false))
  -- Ties break on the EARLIEST log, so a PR keeps the date it was first proved.
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
