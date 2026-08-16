-- D5 — own daytime-HRV: per-user regression replacing Oura's dhrv_imputation ONNX model.
-- One row per user, upserted on refit (throttled, from the raw-sample aggregation pass — see
-- lib/health/daytime-hrv-model.ts). residual_std is the fit's sqrt(mean squared residual) of
-- ln(rmssd), kept as a fit-quality signal for future confidence gating; n_samples is the bucket
-- count the fit used (a floor guards against fitting on too little night-time data).
CREATE TABLE IF NOT EXISTS oura_daytime_hrv_model (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  intercept     DOUBLE PRECISION NOT NULL,
  hr_coef       DOUBLE PRECISION NOT NULL,
  temp_coef     DOUBLE PRECISION NOT NULL,
  residual_std  DOUBLE PRECISION NOT NULL,
  n_samples     INTEGER NOT NULL,
  fitted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
