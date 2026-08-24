-- TN-3a — persist the 30-minute daytime-stress buckets.
--
-- `buildDaytimeStressSeriesFromModel` produces a bucket series on [−1,+1] and `summarizeStressDay`
-- reduces it to three daily scalars on `oura_daily_derived`. The series itself was discarded, so
-- the owner's question — "what days/hours cause most stress" — had no data behind it. Measured
-- 2026-08-24: the daily aggregate spans only −0.14 … +0.23 (sd 0.100) on a [−1,+1] scale, so the
-- day number alone cannot answer it; the buckets are where the information is.
--
-- ROWS, NOT A JSONB ARRAY on oura_daily_derived. The whole point is aggregating ACROSS days by
-- hour of day, which wants rows. Cost is trivial: ~32 buckets per waking day, ~11.7k rows/year,
-- against a database whose largest table is 57 MB.
--
-- `bucket_start` is stored as timestamptz (the bucket's own start instant, from the series' `t`),
-- not an hour-of-day integer: the hour has to be derived in the USER'S timezone at read time, and
-- baking a local hour into the row would freeze it against a timezone change. `day` is the local
-- day the rollup attributed the bucket to, so a query can group by day without re-deriving it.
CREATE TABLE IF NOT EXISTS oura_daytime_stress_buckets (
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day          TEXT        NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  level        DOUBLE PRECISION NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, bucket_start)
);

-- The read this table exists for: one user's buckets over a day range, then grouped by hour.
-- (user_id, day) covers both the range scan and the per-day replace the writer does.
CREATE INDEX IF NOT EXISTS idx_daytime_stress_buckets_user_day
  ON oura_daytime_stress_buckets (user_id, day);
