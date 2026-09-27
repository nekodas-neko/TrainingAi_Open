CREATE TABLE IF NOT EXISTS apple_health_samples (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sample_id uuid NOT NULL,
  sample_type text NOT NULL,
  start_at timestamptz,
  end_at timestamptz,
  quantity_value double precision,
  quantity_unit text,
  category_value integer,
  source_bundle_id text,
  source_name text,
  device_name text,
  device_model text,
  deleted_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sample_id),
  CONSTRAINT apple_health_samples_type CHECK (length(trim(sample_type)) > 0),
  CONSTRAINT apple_health_samples_interval CHECK (
    (start_at IS NULL OR isfinite(start_at)) AND
    (end_at IS NULL OR isfinite(end_at)) AND
    (start_at IS NULL OR end_at IS NULL OR end_at >= start_at)
  ),
  CONSTRAINT apple_health_samples_value CHECK (
    quantity_value IS NULL OR
    (quantity_value > '-Infinity'::double precision AND quantity_value < 'Infinity'::double precision)
  ),
  CONSTRAINT apple_health_samples_payload CHECK (
    deleted_at IS NOT NULL OR (
      start_at IS NOT NULL AND end_at IS NOT NULL AND
      source_bundle_id IS NOT NULL AND length(trim(source_bundle_id)) > 0 AND (
        (quantity_value IS NOT NULL AND quantity_unit IS NOT NULL AND length(trim(quantity_unit)) > 0 AND category_value IS NULL) OR
        (category_value IS NOT NULL AND quantity_value IS NULL AND quantity_unit IS NULL)
      )
    )
  )
);

CREATE INDEX IF NOT EXISTS apple_health_samples_history_idx
  ON apple_health_samples (user_id, sample_type, start_at)
  WHERE deleted_at IS NULL;
