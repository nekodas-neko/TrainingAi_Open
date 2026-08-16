-- Direct-BLE Oura raw event store (Phase 3+4 MVP). One row per raw ring history
-- event: the raw body is kept hex-encoded so decoders can be re-run later
-- (offline re-decode), alongside a best-effort structured decode in `decoded`.
-- Populated by the server-side ingest route POST /api/oura-ble/samples, which
-- decodes frames forwarded from the native BLE plugin. Deduped on
-- (user, ring timestamp, tag, body) so re-draining the ring's history is idempotent.
CREATE TABLE IF NOT EXISTS oura_raw_samples (
  id                BIGSERIAL PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ring_timestamp_ds BIGINT NOT NULL,
  tag               SMALLINT NOT NULL,
  event_name        TEXT NOT NULL,
  body_hex          TEXT NOT NULL,
  decoded           JSONB,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, ring_timestamp_ds, tag, body_hex)
);

CREATE INDEX IF NOT EXISTS oura_raw_samples_user_tag_ts
  ON oura_raw_samples (user_id, tag, ring_timestamp_ds);
