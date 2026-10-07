-- #2094 (TN-86): the middle of each band a sleep verdict was judged against.
--
-- `sleep_verdicts` froze each component's band edges (`*_low` / `*_high`) but not its median,
-- although `ComponentBand.median` is computed alongside them. Without it a correction can later
-- be asked only which side of a threshold the night fell, never how far from centre it sat, and
-- tuning will want the second the moment there are corrections to analyse.
--
-- Additive and nullable, no default, NO backfill. Rows written before this column existed stay
-- NULL for good: their bands came from a trailing 28-night window that has since moved, so a
-- median re-derived today would be a different window's middle stored as if the verdict had
-- seen it. A verdict row is pinned evidence and is never rewritten after the fact.
--
-- `model_version` does not move: recording one more input changes nothing about the rule that
-- produced the verdict, and the version exists to pair a correction with that rule.
ALTER TABLE sleep_verdicts ADD COLUMN IF NOT EXISTS duration_median   double precision;
ALTER TABLE sleep_verdicts ADD COLUMN IF NOT EXISTS onset_median      double precision;
ALTER TABLE sleep_verdicts ADD COLUMN IF NOT EXISTS efficiency_median double precision;
