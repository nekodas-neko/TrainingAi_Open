-- LB-124 — the field TN-58's control writes to, which did not exist anywhere.
--
-- TN-58 asks "is today better or worse than yesterday?" instead of an absolute 1-5, because the
-- absolute scale produced TWO DISTINCT VALUES IN 81 DAYS (measured 2026-09-22: 78 of the owner's 97
-- rows carry a `perceived_recovery`, none of them touched, standard deviation 0.286). A question
-- with no variance cannot be a target for anything, which is what blocks TN-33.
--
-- **Text, not a signed integer, and the reason is this table specifically.** Both were open (LB-124
-- left the choice to build time). Every other scale here stores **1 = best … 5 = worst**, a
-- direction the codebase has to keep restating — `build-day-audit.ts` carries "Stored 1 = slept
-- great … 5 = terrible (the on-screen selector reverses this)". A `-1/0/+1` column where +1 means
-- BETTER would put the opposite polarity in the same row as those, which is exactly the misreading
-- LB-124 warns about. `illness_context` above already stores a text enum on this table, so this
-- follows a shape that is proven here rather than introducing a second convention. TN-33 needs a
-- number to correlate, and gets one from a single shared mapping helper rather than from the
-- column's storage — one formula, one place.
--
-- **NULL is the whole point, so there is NO DEFAULT.** The bug TN-57 just fixed is a neutral value
-- stored as though it were an answer; a default here would recreate it on the very question meant
-- to escape it. A skipped answer stores NULL and reads as "not answered", with no flag needed:
-- unlike the 1-5 scales, this control has no seeded position to accept by leaving it alone.
--
-- No CHECK constraint, deliberately. The Zod schema in packages/shared/src/validation/day-checkin.ts
-- is the one gate both the web route and pushMutations parse, so a constraint here would be a
-- second place for the allowed set to live and drift from.
ALTER TABLE day_checkins
  ADD COLUMN IF NOT EXISTS vs_yesterday text;

COMMENT ON COLUMN day_checkins.vs_yesterday IS
  'TN-58 comparative self-report: better | same | worse. NULL = not answered (no default, by design).';
