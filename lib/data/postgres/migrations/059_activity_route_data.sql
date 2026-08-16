-- Adds GPS route + computed metric storage for live-tracked activities.

ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS route_polyline      TEXT,
  ADD COLUMN IF NOT EXISTS splits              JSONB,
  ADD COLUMN IF NOT EXISTS best_efforts        JSONB,
  ADD COLUMN IF NOT EXISTS pace_series         JSONB,
  ADD COLUMN IF NOT EXISTS avg_pace_sec_per_km DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS elevation_gain_m    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS elevation_loss_m    DOUBLE PRECISION;
