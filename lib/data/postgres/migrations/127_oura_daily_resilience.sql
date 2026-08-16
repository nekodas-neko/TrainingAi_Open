-- Stress-resilience (stress_resilience_2_2_1, Sub-plan E P3). The three per-day indices are the
-- durable rolling-window state the resilience level is fitted over; confidence = valid-days/14;
-- granular = the continuous pre-band level. resilience_level (banded 1.0-5.0) already exists (mig 123).
ALTER TABLE oura_daily_derived
  ADD COLUMN IF NOT EXISTS resilience_daily_stress           DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS resilience_daily_restorative_time DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS resilience_daily_sleep_recovery   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS resilience_granular               DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS resilience_confidence             DOUBLE PRECISION;
