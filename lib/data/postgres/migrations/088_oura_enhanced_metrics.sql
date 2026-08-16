-- Respiratory rate from sleep, stress metrics, and VO2 max from Oura Ring
ALTER TABLE sleep_sessions
  ADD COLUMN IF NOT EXISTS respiratory_rate DOUBLE PRECISION;  -- breaths/min (Oura average_breath)

ALTER TABLE oura_daily
  ADD COLUMN IF NOT EXISTS stress_high     INTEGER,   -- minutes in high stress
  ADD COLUMN IF NOT EXISTS recovery_high   INTEGER,   -- minutes in high recovery
  ADD COLUMN IF NOT EXISTS day_summary     TEXT,      -- 'restored'|'restorative'|'stressful'|'very_stressful'|'passive'
  ADD COLUMN IF NOT EXISTS vo2_max         DOUBLE PRECISION;  -- ml/kg/min (Ring 5+)
