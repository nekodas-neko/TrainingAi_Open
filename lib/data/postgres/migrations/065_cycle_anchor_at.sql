-- Block-cycle progress was anchored to programs.started_at, a calendar date compared
-- against AEST midnight. Every time started_at gets (re)set to "today" — whether by a
-- backfill migration or a fresh automatic-mode activation — countSessionsSinceStart
-- drops back to 0 and the phase calculation snaps back to the first phase (Baseline),
-- discarding sessions already logged this block.
--
-- cycle_anchor_at is a precise timestamp anchor used the same way (count sessions with
-- started_at > cycle_anchor_at), but it is set ONCE — at automatic-mode activation, on
-- "start new block", or via the manual "sessions completed in this block" recalibration
-- — and never silently reset by later migrations. Backfill it from the existing
-- started_at so current phase positions are unaffected until a user recalibrates.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS cycle_anchor_at TIMESTAMPTZ;

UPDATE programs
SET cycle_anchor_at = (started_at::timestamp AT TIME ZONE 'Australia/Brisbane')
WHERE phase_mode = 'automatic' AND started_at IS NOT NULL AND cycle_anchor_at IS NULL;
