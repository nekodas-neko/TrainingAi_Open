-- Batch O phase 1 Task 3: body circumference measurements (waist/chest/arm/thigh/hip/neck).
-- Extends body_metrics rather than a new domain — measurements are sparse per-date
-- numerics exactly like weight/body-fat.
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS waist_cm NUMERIC;
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS chest_cm NUMERIC;
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS arm_cm   NUMERIC;
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS thigh_cm NUMERIC;
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS hip_cm   NUMERIC;
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS neck_cm  NUMERIC;
