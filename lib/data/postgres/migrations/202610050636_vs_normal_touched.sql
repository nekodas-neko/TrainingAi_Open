-- LB-198. `vs_question` (LB-190) marks WHICH question a row answered, and LB-191 then put a second
-- boundary INSIDE question 1: the picker seeds "About the same", so an untouched Save stores a neutral
-- the owner may never have considered. Rows on both sides of that read vs_question = 1.
--
-- `vs_normal_touched` records, per row, whether the owner tapped the picker. NULL means UNKNOWN and is
-- what every row written before this migration holds: they predate the flag, and "unknown" is the
-- truthful value, where false would claim an untouched seed that may have been a considered tap.
-- It is only meaningful beside an answer, so a flag with no answer is refused.
--
-- Additive: one nullable column, no backfill, no rewrite.

ALTER TABLE day_checkins ADD COLUMN IF NOT EXISTS vs_normal_touched boolean;

ALTER TABLE day_checkins DROP CONSTRAINT IF EXISTS day_checkins_vs_touched_check;
ALTER TABLE day_checkins ADD CONSTRAINT day_checkins_vs_touched_check CHECK (
  vs_normal_touched IS NULL OR vs_normal IS NOT NULL
);
