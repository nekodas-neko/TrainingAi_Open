-- BDI reclaim (Sub-plan E). Per-night breathing-disturbance index derived from SleepNet's apnea
-- head (disturbed asleep-epochs per hour of sleep) — our own value, replacing the frozen Oura Cloud
-- oura_daily.breathing_disturbance_index (dead since the re-key). Observational, not a diagnosis.
-- Null on heuristic-fallback nights (no neural apnea head). The frozen Cloud column is left untouched.
ALTER TABLE oura_daily_derived
  ADD COLUMN IF NOT EXISTS bdi_derived DOUBLE PRECISION;
