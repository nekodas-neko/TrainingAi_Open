-- Direct-BLE Renpho ES-20M scale integration.
-- Plan: docs/superpowers/plans/2026-07-27-renpho-ble-direct-scale.md

CREATE TABLE scale_raw_samples (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL,
  raw_hex     TEXT NOT NULL,
  decoded     JSONB,
  status      TEXT NOT NULL DEFAULT 'confirmed', -- 'confirmed' | 'pending' | 'dismissed'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scale_raw_samples_user_time ON scale_raw_samples (user_id, measured_at DESC);
CREATE INDEX idx_scale_raw_samples_user_status ON scale_raw_samples (user_id, status);

ALTER TABLE body_metrics ADD COLUMN skeletal_muscle_pct   DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN fat_free_mass_kg       DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN subcutaneous_fat_pct   DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN visceral_fat_index     DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN body_water_pct         DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN muscle_mass_kg         DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN bone_mass_kg           DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN protein_pct            DOUBLE PRECISION;
ALTER TABLE body_metrics ADD COLUMN bmr_kcal               INTEGER;
ALTER TABLE body_metrics ADD COLUMN metabolic_age          INTEGER;
