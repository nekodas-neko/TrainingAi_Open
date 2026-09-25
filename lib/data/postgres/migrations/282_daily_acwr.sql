-- TN-64 part (a) — store the ACWR the readiness payload already computes.
--
-- The finding TN-64 could not measure: `earlyDeloadRecommended` fires on
-- `score < 45 AND acwr > 1.2`, and in 118 sessions it has never fired. The score half is
-- recorded (`readiness_score` on this table); the ACWR half was computed on every read and
-- thrown away, so "the threshold never opened" and "the gate was never reached" are
-- indistinguishable from the stored data. No change to that gate can be validated until the
-- number it turns on is on the record, which is why this lands BEFORE the condition widens.
--
-- **This table, beside its siblings, rather than a new one.** `training_load_ots`,
-- `training_load_high` and `training_load_gate` are already here, so daily training load is an
-- established tenant of `oura_daily_derived` despite the table's Oura-shaped name. A second
-- daily-metrics table would split one day's row across two places.
--
-- **double precision, matching `training_load_ots`.** ACWR is an unbounded ratio (acute ÷ chronic
-- volume), not a score, so there is no band to encode and no integer to round to.
--
-- **No DEFAULT, and NULL means "not computed", not "no load".** A default of 0 would read as a
-- real ACWR of zero — the bottom of the range, which is a meaningful training state — and would
-- silently enter any later correlation as data. NULL is the honest value for every day before
-- this shipped, and for any day where `computeVolumeAcwr` declines to produce a figure (too
-- little history for a chronic window). This only ever fills forward: nothing back-fills the
-- days already gone, because nothing recorded them at the time.
ALTER TABLE oura_daily_derived
  ADD COLUMN IF NOT EXISTS acwr double precision;

COMMENT ON COLUMN oura_daily_derived.acwr IS
  'TN-64: acute:chronic workload ratio from computeVolumeAcwr, as used by the early-deload gate. NULL = not computed (no default, by design).';
