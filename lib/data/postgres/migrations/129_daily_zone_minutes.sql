-- 129_daily_zone_minutes.sql
-- Server-side rollup CACHE of per-day time-in-HR-zone, derived from oura_heartrate.
-- NOT an offline-first user-write domain: it is recomputed on read (reconcile) and is never written
-- by a device outbox, so it is intentionally absent from RECONCILE_TABLES / the local store. One row
-- per (user, local date).
CREATE TABLE IF NOT EXISTS daily_zone_minutes (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day         date NOT NULL,                 -- user-local date (YYYY-MM-DD)
  zone1_sec   integer NOT NULL DEFAULT 0,
  zone2_sec   integer NOT NULL DEFAULT 0,
  zone3_sec   integer NOT NULL DEFAULT 0,
  zone4_sec   integer NOT NULL DEFAULT 0,
  zone5_sec   integer NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
