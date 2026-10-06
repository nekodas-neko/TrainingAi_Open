-- #2450 (step 1 of #2253): whether a set's RPE was tapped by the lifter or left at the value the
-- picker opened on.
--
-- The picker pre-fills the expected effort, and the owner's rule (2026-10-06, on #2253) is that an
-- untouched value means "went as predicted". Today nothing records which sets were touched: 88% of
-- logged RPEs since August equal the pre-fill, and they cannot be told apart from real ratings
-- afterwards. Only a `rated` value may move the plan, and calibration (#2252) and the analytics
-- that read set RPE (#2104, #2418) need to separate the two, so the fact gets its own column.
--
--   'rated'    — the lifter set the value on the picker
--   'expected' — the value is the picker's pre-fill, never touched
--   NULL       — no RPE on the set, or logged before this column existed
--
-- Additive and nullable, no default. No backfill: matching `rpe` against today's pre-fill formula
-- would guess, and only for rows that stored `planned_pct`. An honest NULL beats a plausible label.
ALTER TABLE set_logs ADD COLUMN IF NOT EXISTS rpe_source text
  CHECK (rpe_source IN ('expected', 'rated'));
