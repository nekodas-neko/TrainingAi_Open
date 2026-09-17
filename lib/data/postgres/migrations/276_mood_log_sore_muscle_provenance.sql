-- BF-173. `sore_muscles` could not say where a tick came from, and the session scorer needed to
-- know: `suggestedSoreMuscles` pre-ticks any muscle trained within 48 h and under 85% recovered,
-- then `sessionRecoveryScore` clamps that same muscle to `min(pct, 40)`. One fact -- "you trained
-- legs 47 hours ago" -- counted twice, with the second pass overwriting the model's own figure
-- with a harsher flat one. Measured on the owner's 2026-09-17 rows: quads scored 69 became 40,
-- chest 49 became 40, and the flat floor collapsed the ordering the recovery model had just
-- computed. It changed the recommendation -- Lower 74/Upper 84 shipped, Lower 85/Upper 84 with the
-- leg ticks removed.
--
-- NULLABLE, and the null means "unknown", not "none". Rows written before this column existed
-- cannot say which of their ticks were suggestions, so they keep today's behaviour (every tick
-- clamps) rather than being retroactively reinterpreted. Only the scorer reads it, and only for
-- the current day's log, so the unknown span is at most one check-in.
--
-- An empty array is therefore meaningful and different from NULL: it says the write path looked
-- and found that none of these ticks were model suggestions -- i.e. the lifter volunteered all of
-- them, and every one should clamp.
ALTER TABLE mood_logs ADD COLUMN IF NOT EXISTS suggested_sore_muscles text[];

COMMENT ON COLUMN mood_logs.suggested_sore_muscles IS
  'BF-173: the subset of sore_muscles the model itself pre-ticked. NULL = unknown (written before '
  'provenance existed); empty array = checked, none were suggestions. sessionRecoveryScore clamps '
  'only ticks NOT in this list, so an accepted suggestion falls through to its own recovery pct '
  'instead of being counted a second time.';
