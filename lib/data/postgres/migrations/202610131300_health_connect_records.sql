CREATE TABLE IF NOT EXISTS health_connect_records (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_id text NOT NULL CHECK (length(record_id) BETWEEN 1 AND 200),
  record_payload jsonb,
  modified_at timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, record_id),
  CHECK (deleted_at IS NOT NULL OR (record_payload IS NOT NULL AND modified_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS health_connect_projection_state (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL
);
