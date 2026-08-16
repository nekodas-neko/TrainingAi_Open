-- Cadence (steps/min) on activity logs.
--
-- Derived from the Oura ring's decoded stride frequency and/or the Polar H10's
-- accelerometer (lib/health/cadence.ts). cadence_source records WHICH sensor produced the
-- stored average: the two derivations are independent and their agreement is the only
-- available check on either, so a reading without its provenance can't be interpreted later.
--
-- Additive and nullable throughout — every existing row stays valid with cadence unknown,
-- and nothing backfills (cadence cannot be reconstructed from a route that was never
-- measured with a cadence sensor).

ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS cadence_spm    DOUBLE PRECISION;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS cadence_series JSONB;
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS cadence_source TEXT;

COMMENT ON COLUMN activity_logs.cadence_spm IS
  'Average cadence in steps per minute across locomotor readings only (pauses excluded).';
COMMENT ON COLUMN activity_logs.cadence_series IS
  'Binned cadence over the activity: [{ "tSec": int, "spm": number }], one point per 10s bin.';
COMMENT ON COLUMN activity_logs.cadence_source IS
  'Which sensor produced the stored cadence: ''ring'' or ''strap''.';
