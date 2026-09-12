-- BF-147: the owner asked for "a way to flag if [a GIF] is wrong so we can decide how to proceed".
-- Nothing like it existed — searched `needs_review`, `gif_status`, `verified`, `approved`,
-- `flagged`, `mismatch` and `reviewStatus` across every exercise and media table: zero hits.
-- `exercise_media` carried only `model_used`/`generated_at`, `exercise_gif_cache` only urls, and
-- `exercise_library` nothing. The admin Feedback tab could hold "this GIF is wrong" as free text,
-- but it has no entity linkage and no status field, so nothing on the Exercises tab could read it.
--
-- The column goes on `exercise_media` rather than a new table because that is where the decision
-- belongs: the row already carries the unique `(exercise_name, gender)` key and its provenance, so
-- a verdict sits beside `model_used` and survives the regeneration decisions it exists to inform.
--
-- **`wrong` is deliberately NOT coupled to regeneration.** Marking a GIF wrong must not trigger an
-- AI call — collecting the wrong ones IS the point, because "so we can decide how to proceed" is a
-- set to review, not an action to fire. The status is the record; what to do about it is separate.
--
-- Not destructive and fully reversible: one nullable-with-default column plus a timestamp. Every
-- existing row becomes `unreviewed`, which is true of all of them — nothing has been reviewed. The
-- CHECK constraint is the enum; a text column with a constraint rather than a Postgres enum type,
-- matching the rest of this schema (`gender`, `stepsGoalType`, `dayType` are all text + app-level
-- validation) and avoiding the ALTER TYPE dance when a fourth verdict is wanted.
-- Reversible by `ALTER TABLE exercise_media DROP COLUMN review_status, DROP COLUMN reviewed_at`.

ALTER TABLE exercise_media
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'unreviewed';

ALTER TABLE exercise_media
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

ALTER TABLE exercise_media DROP CONSTRAINT IF EXISTS exercise_media_review_status_check;
ALTER TABLE exercise_media
  ADD CONSTRAINT exercise_media_review_status_check
  CHECK (review_status IN ('unreviewed', 'ok', 'wrong'));

-- The queryable set the owner asked for: "which ones are wrong" is the whole deliverable, and it is
-- a small minority of 152 rows, so a partial index over the verdicts is the right shape.
CREATE INDEX IF NOT EXISTS exercise_media_review_status_flagged
  ON exercise_media (review_status)
  WHERE review_status <> 'unreviewed';
