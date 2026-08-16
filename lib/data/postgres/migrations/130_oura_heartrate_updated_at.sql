-- Phase-2 durability B1: give oura_heartrate an `updated_at` so it can become a
-- restorable backup domain (dedicated Track-B timeseries sync). Without it the delta
-- would have to key on `timestamp`, and a re-decoded/corrected historical point (old
-- timestamp) would never re-sync — silent loss (review R1). The write path bumps
-- `updated_at` only when bpm/source actually change, so a corrected point advances its
-- cursor and re-syncs, while an unchanged re-roll does not churn the sync.
--
-- Back-fill existing rows from their measurement timestamp (stable, spread out — not one
-- big now() batch) so the first restore has a sane per-row cursor; new/updated rows get
-- now() via the default + the write path.
ALTER TABLE oura_heartrate ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
UPDATE oura_heartrate SET updated_at = timestamp WHERE updated_at IS NULL;
ALTER TABLE oura_heartrate ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE oura_heartrate ALTER COLUMN updated_at SET NOT NULL;

-- Keyset pagination index for the dedicated Track-B pull cursor: (user_id, updated_at, id).
-- The composite (updated_at, id) tiebreak is safe here precisely because this is a single
-- domain endpoint (one id-space) — unlike the shared cross-domain scalar cursor.
CREATE INDEX IF NOT EXISTS oura_heartrate_user_updated ON oura_heartrate(user_id, updated_at, id);
