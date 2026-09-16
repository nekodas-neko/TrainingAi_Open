-- LA-114 — `oura_daytime_stress_buckets.bucket_start` has never held a bucket start. It holds the
-- bucket's MIDPOINT, and has since the table was created: `daytimeHrvEstimatesPerBucket` returns
-- `t = bStart + bucketMs / 2`, `scoreStressPoints` carries `t` through, and `run.ts` writes
-- `new Date(p.tMs)` straight into this column. Stored timestamps sit on a :15/:45 grid.
--
-- Migration 212's own header is where the mistake is written down — "the bucket's own start
-- instant, from the series' `t`". The series' `t` is not the start.
--
-- ⛔ THE COLUMN IS NOT RENAMED, AND CANNOT BE. Do not try again without reading this.
--
-- The rename was written, applied, and reverted on 2026-09-16. It fails the Migration Check job's
-- second step — "Migrations are idempotent (replay against a schema that already has everything)",
-- LA-13 — in two independent ways:
--
--   1. `ALTER TABLE ... RENAME COLUMN bucket_start TO bucket_mid` is not idempotent: on replay the
--      old name is gone and it errors. That one is fixable with an `information_schema` guard.
--   2. The one that is NOT fixable: every historical `claude_ro` view migration — 213, 215, 218,
--      221 … 274 — contains `SELECT ... t.bucket_start ... FROM public.oura_daytime_stress_buckets`,
--      because each regenerates the FULL view set. After a rename every one of them fails on
--      replay. Making them pass would mean editing already-applied migrations, which this repo
--      forbids for a reason `ensureSchema` enforces: it tracks by FILENAME, so an edited file is
--      skipped forever and the change silently never lands.
--
-- So the repo's idempotency contract and a column rename are incompatible for any column an
-- earlier migration names. That is a property of the migration model, not of this column.
--
-- What is done instead: the Drizzle property is `bucketMid` (schema.ts), every TypeScript reader
-- says `bucketMid`, and this comment makes the database itself self-describing to `\d+` and
-- `pg_description`. The value is not wrong — a midpoint is a legitimate representative of a
-- 30-minute bucket and the stress-day chart plots it as a point in time — so nothing is re-stamped.
--
-- ⚠ THE GAP THIS LEAVES, stated plainly: `claude_ro.oura_daytime_stress_buckets` still exposes the
-- column as `bucket_start`, and that read surface is where the defect actually bit — a join written
-- the obvious way against another 30-minute series on the epoch grid returns ZERO rows, which reads
-- as "no overlapping data" rather than "the join is 15 minutes out". It cost an hour during TN-39's
-- validation. Adding the 15 minutes is the caller's job until something better exists.
--
-- Idempotent: `COMMENT ON COLUMN` is a set, not an add, and it names no column that a historical
-- migration would stop finding.

COMMENT ON COLUMN oura_daytime_stress_buckets.bucket_start IS
  'MIDPOINT of the 30-minute bucket, not its start (t = bucketStart + bucketMs/2). Misnamed at '
  'creation in migration 212; renaming is blocked by the migration-replay contract — see migration '
  '275. Subtract 15 minutes to get the bucket start before joining on an epoch-aligned grid.';
