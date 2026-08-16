-- Q-26: the exercise names merged away by 163/164 are still selectable in the picker.
--
-- 163/164 moved every user's log history and personal-record row onto a canonical exercise name,
-- but deliberately left `exercise_library` alone — it is a GLOBAL catalogue (not per-user), so
-- deleting a row is a different decision with a different blast radius than a per-user data merge
-- (other accounts, `exercise_id` FKs from historical rows). Consequence: `Cable Lat Pulldown`,
-- `Straight Arm Pulldown` and `Cable Crunch` still appear in the exercise picker, and picking one
-- re-opens the split 163/164 just closed.
--
-- `merged_into` is nullable and additive — every existing row keeps its id, name and FKs valid.
-- The picker filters out rows where it is set (see lib/data/postgres/adapter.ts
-- listExerciseLibrary); a future UI can use it to suggest "use Cable Pulldown instead".
ALTER TABLE exercise_library
  ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES exercise_library(id);

CREATE INDEX IF NOT EXISTS idx_exercise_library_merged_into ON exercise_library (merged_into);

-- Backfill the three rows 163/164 actually merged away (idempotent — matches by exact name and
-- only sets merged_into when both sides exist and are distinct).
UPDATE exercise_library child
SET merged_into = canonical.id
FROM (VALUES
  ('Cable Lat Pulldown',    'Cable Pulldown'),
  ('Straight Arm Pulldown', 'Cable Pulldown'),
  ('Cable Crunch',          'Cable Crunch Abs')
) AS p(old_name, canonical_name)
JOIN exercise_library canonical ON canonical.name = p.canonical_name
WHERE child.name = p.old_name
  AND child.id <> canonical.id
  AND child.merged_into IS NULL;
