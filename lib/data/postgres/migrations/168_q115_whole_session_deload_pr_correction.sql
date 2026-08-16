-- Q-115: correct the four personal_records rows a whole-session AI deload wrote as genuine PRs.
--
-- Root cause (fixed in code the same PR as this migration): buildWholeSessionDeloadPrescription
-- never stamped `deloaded: true` on the exercises it produced, so every downstream consumer keyed
-- on that flag — the 1RM estimator, the client's PR-flash gate, and the server's
-- shouldCountTowardPr gate — treated a deliberately submaximal deload set as a genuine top set.
-- A per-exercise deload (the other half of Q-115) was NOT affected: its exerciseDeloaded flag was
-- already set correctly, so shouldCountTowardPr already blocked it from reaching this table.
--
-- Audited against production before writing (read-only, `claude_ro`) on 2026-08-07. Exactly four
-- rows are affected, all from one whole-session deload logged 2026-08-06 21:47-22:09 UTC (the
-- session the owner reported: "4 of 5 completed exercises... all flagged Personal Records").
-- Verified each corrected value against that exercise's own real log history (the true max BEFORE
-- the corrupted session, re-confirmed with an aggregate MAX() query, not eyeballed from a list):
--
--   Barbell Overhead Press   60.50 -> 57.50   true max logged 2026-07-30
--   Barbell Skull Crusher    48.00 -> 46.00   true max logged 2026-07-30
--   Cable Preacher Curl      19.25 -> 17.00   true max logged 2026-07-30
--   Cable Pulldown           37.25 -> 36.00   true max logged 2026-07-03 (higher than 07-30's 30)
--
-- Expressed generically over users (WHERE matches on exercise_name + the exact corrupted value),
-- not against one account — a no-op for any database that does not have these exact rows. Unlike
-- migration 163's general reconciliation pass, this is NOT re-derived from a generic "best log"
-- query: the corrupted logs themselves still carry exercise_deloaded = false (that IS the bug),
-- so a generic re-derivation would just pick the same inflated numbers back up. Both the log rows
-- and the PR rows are corrected together so a future reconciliation pass sees consistent history.

-- ── 1. Mark the four corrupted logs so history matches what the fixed code would have written ──
UPDATE exercise_logs
SET exercise_deloaded = true,
    estimated_1rm = 0,
    updated_at = now()
FROM (VALUES
  ('Barbell Overhead Press', 60.50),
  ('Barbell Skull Crusher',  48.00),
  ('Cable Preacher Curl',    19.25),
  ('Cable Pulldown',         37.25)
) AS bad(exercise_name, bad_1rm)
WHERE exercise_logs.exercise_name = bad.exercise_name
  AND exercise_logs.estimated_1rm = bad.bad_1rm
  AND exercise_logs.exercise_deloaded = false
  AND exercise_logs.logged_at >= '2026-08-06T21:00:00Z'
  AND exercise_logs.logged_at <  '2026-08-06T23:00:00Z';

-- ── 2. Correct the personal_records rows those logs inflated ────────────────────────────────────
UPDATE personal_records pr
SET estimated_1rm = fix.true_1rm,
    achieved_at = fix.true_achieved_at
FROM (VALUES
  ('Barbell Overhead Press', 60.50, 57.50, '2026-07-30T22:28:28.251Z'::timestamptz),
  ('Barbell Skull Crusher',  48.00, 46.00, '2026-07-30T22:37:30.782Z'::timestamptz),
  ('Cable Preacher Curl',    19.25, 17.00, '2026-07-30T22:44:46.662Z'::timestamptz),
  ('Cable Pulldown',         37.25, 36.00, '2026-07-03T00:43:54.573Z'::timestamptz)
) AS fix(exercise_name, bad_1rm, true_1rm, true_achieved_at)
WHERE pr.exercise_name = fix.exercise_name
  AND pr.estimated_1rm = fix.bad_1rm;
