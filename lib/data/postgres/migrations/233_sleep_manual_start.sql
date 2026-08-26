-- Q-519 — a bedtime the user remembers for a night the ring did not observe.
--
-- Its own column, deliberately NOT `sleep_start`. The original design wrote the remembered value
-- into `sleep_start` at `manual` rank and leaned on the per-field merge to leave the measured
-- columns alone. The audit that entry commissioned found that unsafe
-- (docs/reviews/2026-08-26-manual-bedtime-write-audit.md): `aggregateNight` recomputes time-in-bed
-- and efficiency from `sleep_end - sleep_start` on a fragmented night, the daytime-HRV model
-- classifies samples by window membership and reads the stored rows, and `primaryCluster` unions
-- same-date rows within an hour of the window. A 23:00 bedtime over a 04:23-08:03 measured night
-- produced 9.05 h at 34% efficiency and moved five awake hours into a nightly training set.
--
-- The per-field merge exists to let a better MEASUREMENT of the same quantity win. A remembered
-- bedtime is a different quantity, so it gets a different column, and only the bedtime estimate
-- reads it. Nothing that derives a window, a duration or an efficiency ever sees it.
ALTER TABLE sleep_sessions ADD COLUMN IF NOT EXISTS manual_sleep_start timestamptz;

COMMENT ON COLUMN sleep_sessions.manual_sleep_start IS
  'Q-519: user-remembered bedtime for a night the ring missed. Read ONLY by the bedtime estimate. Never feeds a window, duration or efficiency - see docs/reviews/2026-08-26-manual-bedtime-write-audit.md.';
