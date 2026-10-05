-- LB-190. `day_checkins.vs_yesterday` becomes `vs_normal`, because OR-206 changes the morning question
-- from "compared to yesterday" to "compared to normal" and a column whose name contradicts its
-- question is how the next reader gets it wrong.
--
-- The two questions are different measurements, so each answered row now records which one it
-- answered in `vs_question` (1 = yesterday, 2 = normal). A deploy date cannot mark the boundary:
-- Railway ships on merge, so one local day can hold rows from both sides. Every answer stored before
-- this migration replied to question 1, so it is backfilled as such. Unanswered rows stay NULL.
--
-- Additive and reversible: a rename, a nullable column, and a backfill of that column only.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'day_checkins' AND column_name = 'vs_yesterday')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'day_checkins' AND column_name = 'vs_normal') THEN
    ALTER TABLE day_checkins RENAME COLUMN vs_yesterday TO vs_normal;
  END IF;
END $$;

ALTER TABLE day_checkins ADD COLUMN IF NOT EXISTS vs_question smallint;

UPDATE day_checkins SET vs_question = 1 WHERE vs_normal IS NOT NULL AND vs_question IS NULL;

ALTER TABLE day_checkins DROP CONSTRAINT IF EXISTS day_checkins_vs_question_check;
ALTER TABLE day_checkins ADD CONSTRAINT day_checkins_vs_question_check CHECK (
  (vs_normal IS NULL AND vs_question IS NULL)
  -- IS NOT NULL is load-bearing: `NULL IN (1, 2)` is NULL, and a CHECK passes on NULL.
  OR (vs_normal IS NOT NULL AND vs_question IS NOT NULL AND vs_question IN (1, 2))
);
