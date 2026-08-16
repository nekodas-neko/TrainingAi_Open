-- Oura: cardiovascular age + resilience data on oura_daily
ALTER TABLE oura_daily
  ADD COLUMN IF NOT EXISTS vascular_age         INTEGER,
  ADD COLUMN IF NOT EXISTS pulse_wave_velocity   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS resilience_level      TEXT,
  ADD COLUMN IF NOT EXISTS resilience_contributors JSONB;
