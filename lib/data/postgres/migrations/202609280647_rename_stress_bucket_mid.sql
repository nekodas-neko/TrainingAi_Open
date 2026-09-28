-- LA-114 — `oura_daytime_stress_buckets.bucket_start` has always held the bucket's MIDPOINT
-- (t = bucketStart + bucketMs/2), so a join written the obvious way against an epoch-aligned 30-minute
-- series lands 15 minutes out and returns nothing. Migration 275 could only comment on it: every
-- historical `claude_ro` view migration selected `t.bucket_start`, and a rename broke all of them
-- on replay. BF-214 deleted those migrations, so the rename is now one replay exemption (275's
-- COMMENT, which names the old column) rather than a dozen.
--
-- Idempotent: renames only while the old column exists. The primary key follows the column, and the
-- claude_ro views are rebuilt from the regenerated views file after this runs.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'oura_daytime_stress_buckets' AND column_name = 'bucket_start'
  ) THEN
    ALTER TABLE oura_daytime_stress_buckets RENAME COLUMN bucket_start TO bucket_mid;
  END IF;
END $$;

COMMENT ON COLUMN oura_daytime_stress_buckets.bucket_mid IS
  'MIDPOINT of the 30-minute bucket (t = bucketStart + bucketMs/2). Named bucket_start until LA-114. '
  'Subtract 15 minutes for the bucket start before joining on an epoch-aligned grid.';
