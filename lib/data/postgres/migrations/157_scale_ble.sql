-- Direct-BLE Renpho ES-20M scale integration.
-- Plan: docs/superpowers/plans/2026-07-27-renpho-ble-direct-scale.md
--
-- IDEMPOTENT: every statement is IF NOT EXISTS, so a partially-applied run can retry.

CREATE TABLE IF NOT EXISTS scale_raw_samples (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL,
  raw_hex     TEXT NOT NULL,
  decoded     JSONB,
  status      TEXT NOT NULL DEFAULT 'confirmed', -- 'confirmed' | 'pending' | 'dismissed'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scale_raw_samples_user_time ON scale_raw_samples (user_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_scale_raw_samples_user_status ON scale_raw_samples (user_id, status);

ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS skeletal_muscle_pct   DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS fat_free_mass_kg       DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS subcutaneous_fat_pct   DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS visceral_fat_index     DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS body_water_pct         DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS muscle_mass_kg         DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS bone_mass_kg           DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS protein_pct            DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS bmr_kcal               INTEGER;
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS metabolic_age          INTEGER;
