-- Phase-2 durability B1: server mirror of the on-device `oura_bucket` coarse-tier store
-- (the RRD trend ladder). It exists only in local SQLite (lib/sqlite/migrations.ts) — there
-- was no server table, so Track-B's coarse-tier backup had nowhere to land (review R1). This
-- is the durable backup destination; it never computes (device-primary), only stores.
--
-- Mirrors the local columns. `bucket_start_ms`/`bucket_start_ds` are epoch/decisecond values
-- that exceed INT4, so BIGINT. `user_id` is added (the local single-user DB has none). The
-- coarse tiers are FOREVER-retained (unlike oura_heartrate's 180d prune) — do not add a prune.
-- 130 was the free gap; 136 is pre-claimed by the parent raw-on-device spec.
CREATE TABLE IF NOT EXISTS oura_bucket (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier            TEXT        NOT NULL,
  bucket_start_ms BIGINT      NOT NULL,
  bucket_start_ds BIGINT      NOT NULL,
  local_date      DATE        NOT NULL,
  hr_mean         DOUBLE PRECISION,
  hr_min          DOUBLE PRECISION,
  hr_max          DOUBLE PRECISION,
  hrv_rmssd_ms    DOUBLE PRECISION,
  spo2_pct        DOUBLE PRECISION,
  perfusion_index DOUBLE PRECISION,
  skin_temp_c     DOUBLE PRECISION,
  met_mean        DOUBLE PRECISION,
  met_minutes     DOUBLE PRECISION,
  motion_mad      DOUBLE PRECISION,
  ibi_ms          TEXT,
  sample_count    INTEGER,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, tier, bucket_start_ms)
);

-- Keyset pagination index for the dedicated Track-B pull cursor: (user_id, updated_at, id).
CREATE INDEX IF NOT EXISTS oura_bucket_user_updated ON oura_bucket(user_id, updated_at, id);
