-- Q-228: zero the one deload log that migration 168 missed, so its own history is internally
-- consistent with what the fixed code would have written.
--
-- Background. 168 (2026-08-07) corrected the whole-session AI deload of 2026-08-06 — the Q-115
-- corruption, where buildWholeSessionDeloadPrescription never stamped `deloaded: true`, so every
-- gate keyed on that flag treated a deliberately submaximal set as a genuine top effort. It audited
-- the 21:47-22:09 UTC window and fixed four exercises. **Incline Bench Press was exercise 1 of that
-- same session, logged at 21:41:20 — six minutes before the audited window opened — and was never
-- touched.** It carries the contradiction the other four had: `exercise_deloaded = true` alongside
-- `estimated_1rm = 85.75` and `target_80 = 44.5`, the values a 42.5kg x 8 / 42.5kg x 11 pair
-- produces when run through calculate1RM's prescriptionFactor rescale as if 52% were a top effort.
--
-- Both columns are zeroed, not just the 1RM. getLastRealOneRmBatch's own doc comment says a deload
-- row stores 0 in `target_80` too — it is the displayed target AND the weight the dial pre-fills to,
-- so a non-zero value on a deload row is the same class of lie one field along. 168 only had to
-- clear `estimated_1rm` because its four rows already carried target_80 = 0.
--
-- No personal_records correction is needed here, unlike 168. shouldCountTowardPr DOES check
-- exercise_deloaded, so this row never reached that table: the PR is 78.75 from 2026-07-30, which is
-- correct. Confirmed by query, not assumed.
--
-- This is history hygiene, not a live fix. Verified against production on 2026-08-14: the owner
-- logged a real Incline Bench Press set on 2026-08-13 at estimated_1rm = 76.5, which is newer, so
-- getLastRealOneRmBatch's DISTINCT ON already resolves past this row. The structural gap it exposed
-- — that query having no exercise_deloaded filter — is fixed in code in the same PR and is the part
-- that matters going forward. Left uncorrected, this row stays a trap for any future reconciliation
-- pass or analysis that reads log history directly.
--
-- Expressed over the exact corrupted values rather than a user id, same as 168 — a no-op for any
-- database that does not hold this exact row, and idempotent (the WHERE stops matching once run).

UPDATE exercise_logs
SET estimated_1rm = 0,
    target_80 = 0,
    updated_at = now()
WHERE exercise_name = 'Incline Bench Press'
  AND exercise_deloaded = true
  AND estimated_1rm = 85.75
  AND logged_at >= '2026-08-06T21:00:00Z'
  AND logged_at <  '2026-08-06T23:00:00Z';
