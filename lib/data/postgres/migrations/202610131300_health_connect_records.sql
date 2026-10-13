CREATE TABLE IF NOT EXISTS health_connect_records (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_id text NOT NULL CHECK (length(record_id) BETWEEN 1 AND 200),
  record_payload jsonb,
  record_type text,
  start_at timestamptz,
  end_at timestamptz,
  value double precision,
  source_package text,
  modified_at timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, record_id),
  CHECK (deleted_at IS NOT NULL OR (record_payload IS NOT NULL AND modified_at IS NOT NULL))
);
ALTER TABLE health_connect_records ADD COLUMN IF NOT EXISTS record_type text;
ALTER TABLE health_connect_records ADD COLUMN IF NOT EXISTS start_at timestamptz;
ALTER TABLE health_connect_records ADD COLUMN IF NOT EXISTS end_at timestamptz;
ALTER TABLE health_connect_records ADD COLUMN IF NOT EXISTS value double precision;
ALTER TABLE health_connect_records ADD COLUMN IF NOT EXISTS source_package text;
UPDATE health_connect_records SET
  record_type=record_payload->>'type',
  start_at=(record_payload->>'start')::timestamptz,
  end_at=(record_payload->>'end')::timestamptz,
  value=CASE WHEN jsonb_typeof(record_payload->'value')='number' THEN (record_payload->>'value')::double precision END,
  source_package=record_payload->>'sourcePackage'
WHERE record_type IS NULL AND record_payload ? 'start' AND record_payload ? 'end';
CREATE INDEX IF NOT EXISTS health_connect_records_range_idx
  ON health_connect_records(user_id, record_type, start_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS health_connect_records_rebuild_idx
  ON health_connect_records(user_id, start_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS apple_health_samples_rebuild_idx
  ON apple_health_samples(user_id, start_at) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS native_health_projection_days (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('apple_health','health_connect_native')),
  day date NOT NULL,
  pending boolean NOT NULL DEFAULT true,
  daily jsonb,
  PRIMARY KEY (user_id, source, day)
);
CREATE INDEX IF NOT EXISTS native_health_projection_pending_idx
  ON native_health_projection_days(user_id,source,day) WHERE pending;
CREATE TABLE IF NOT EXISTS health_connect_projection_state (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL
);
