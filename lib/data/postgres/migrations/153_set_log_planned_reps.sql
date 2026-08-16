-- Q-14: `planned_pct` and `intensity_pct` were on different bases for bodyweight exercises.
--
-- `intensity_pct` is BW_REF-relative, while `planned_pct` stored the progression style's nominal
-- percentage. For a bodyweight movement that percentage is never a load target — `resolveBodyweightStyle`
-- (lib/1rm.ts) converts it into a REP target instead, because bodyweight carries no %1RM. So the two
-- columns could never agree, and every bodyweight set recorded a phantom 14-18 pp "overshoot":
-- Pull-Up planned 75.0 / actual 88.5, Hanging Leg Raise planned 68.0 / actual 83.9. Weighted
-- exercises deviate by <= 2.3 pp, which is real autoregulation.
--
-- Owner decision (2026-07-27): NULL `planned_pct` where no %1RM was ever prescribed, and record the
-- prescribed rep target in its own column. `planned_reps` is written for EVERY exercise, not just
-- bodyweight — the style carries a rep target for weighted work too, and having it makes
-- "did the prescription get delivered" answerable everywhere rather than only where it broke.
--
-- Cheap now on purpose: `planned_pct` has only existed since 2026-07-18 and covers 110 of 819 sets,
-- of which just 6 are bodyweight.

ALTER TABLE set_logs     ADD COLUMN IF NOT EXISTS planned_reps integer;
ALTER TABLE set_hr_stats ADD COLUMN IF NOT EXISTS planned_reps integer;

-- Clear the percentages that were never a load target. Idempotent: re-running matches nothing,
-- because the predicate is `IS NOT NULL`.
--
-- `planned_reps` is deliberately left NULL for these historical rows. It could be reconstructed as
-- floor(pct/100 * repMaxFromOneRm(1rm-at-the-time)), but that 1RM has since moved, so the result
-- would be a plausible invention rather than the target the lifter was actually shown. An honest
-- NULL is better than a reconstructed number that cannot be checked.
UPDATE set_logs sl
SET planned_pct = NULL
FROM exercise_logs el
JOIN exercise_library lib ON lower(lib.name) = lower(el.exercise_name)
WHERE sl.exercise_log_id = el.id
  AND lib.exercise_type = 'bodyweight'
  AND sl.planned_pct IS NOT NULL;

UPDATE set_hr_stats s
SET planned_pct = NULL
FROM exercise_library lib
WHERE lower(lib.name) = lower(s.exercise_name)
  AND lib.exercise_type = 'bodyweight'
  AND s.planned_pct IS NOT NULL;
