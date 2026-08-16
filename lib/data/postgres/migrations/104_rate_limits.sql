-- Shared rate-limit counters. One row per limiter key; the window rolls
-- forward atomically in the upsert (see lib/rate-limit.ts). Survives deploys
-- and is shared across replicas, unlike the in-memory L1 map.
CREATE TABLE IF NOT EXISTS rate_limits (
  key          text PRIMARY KEY,
  count        integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);
