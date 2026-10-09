-- LA-71 (#2196) — `scale_raw_samples` gets the unique key it never had: one archived frame per
-- (user_id, measured_at, raw_hex). PS-33 dedups a re-send in `insertScaleRawSample` with a
-- select-then-insert, and a pre-check is not a constraint: two simultaneous posts of the same bytes
-- can both pass the select and both insert. The index closes that; the insert now relies on it.
--
-- **This migration DELETES rows. Owner-approved 2026-10-05 on #2196**, in exactly this shape:
-- exact duplicates only — same user, same timestamp, byte-identical `raw_hex` — and the LOWEST id in
-- each group survives. A row that differs in any byte, any instant or any account is not touched.
-- Measured beforehand on the owner's account: 0 duplicates in 99 rows. Other accounts could not be
-- counted (claude_ro is row-scoped), so the delete runs before the index, or a single duplicate
-- anywhere would fail the build.
--
-- Guards:
--   1. COUNT SELF-CHECK. The rows deleted must equal the rows predicted immediately before
--      (rows minus distinct triples), or the whole block rolls back.
--   2. A GROUP THAT DISAGREES ON `status` ABORTS EVERYTHING. `status` is the user's own
--      confirm / not-me answer, not part of the frame, so two copies that disagree on it are not
--      the "exact duplicates" the owner approved deleting — keeping the lowest id could resurrect a
--      prompt the user already answered. That case raises (SQLSTATE P0001, which ensureSchema
--      reports as FAILED, not "already present"), nothing is deleted, no index is built, and it
--      comes back to the owner. `decoded` is a disposable best-effort snapshot (see schema.ts) and
--      is only counted in the NOTICE, not used to block.
--   3. ONE TRANSACTION. Everything is a single DO block, so a delete never lands without its index
--      and an index failure takes the deletes back with it.
--   4. THE COUNT IS RECORDED WHERE IT CAN BE READ LATER. `ensureSchema` does not log NOTICEs, so in
--      production the RAISE NOTICE below goes nowhere. The deleted-row count is also written into
--      the index's COMMENT, readable through the admin query endpoint at release:
--        SELECT obj_description('public.scale_raw_samples_user_measured_raw_uq'::regclass, 'pg_class')
--      It counts every account (pg_catalog is not row-scoped). Expected on release: "deleted 0".
--
-- `raw_hex` is indexed directly rather than through md5(): the native decoder sends one BLE frame
-- (11–20 bytes, 22–40 hex characters) and the ingest route caps it at 256 characters, two orders of
-- magnitude under the ~2.7 kB btree entry limit. A legacy row long enough to break that limit would
-- make CREATE UNIQUE INDEX fail (54000) and roll the deletes back with it — fail closed.
--
-- Replay-safe: once the index exists the block deletes nothing and only says so. On a clean
-- database it deletes nothing and builds the index.

DO $$
DECLARE
  total_rows    bigint;
  distinct_keys bigint;
  predicted     bigint;
  deleted       bigint;
  accounts      bigint;
  conflicting   bigint;
  decoded_diff  bigint;
BEGIN
  IF to_regclass('public.scale_raw_samples_user_measured_raw_uq') IS NOT NULL THEN
    RAISE NOTICE 'LA-71: scale_raw_samples_user_measured_raw_uq already exists; deleted 0 rows';
    RETURN;
  END IF;

  -- Writes wait until the index is built: a row inserted between the delete and CREATE INDEX could
  -- otherwise re-create a duplicate and fail the build.
  LOCK TABLE scale_raw_samples IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO conflicting FROM (
    SELECT 1 FROM scale_raw_samples
     GROUP BY user_id, measured_at, raw_hex
    HAVING count(*) > 1 AND count(DISTINCT status) > 1
  ) g;
  IF conflicting > 0 THEN
    RAISE EXCEPTION 'LA-71: % duplicate group(s) in scale_raw_samples disagree on status; nothing deleted, index not built — ask the owner (#2196)', conflicting;
  END IF;

  SELECT count(*) INTO decoded_diff FROM (
    SELECT 1 FROM scale_raw_samples
     GROUP BY user_id, measured_at, raw_hex
    HAVING count(*) > 1 AND count(DISTINCT decoded::text) + max(CASE WHEN decoded IS NULL THEN 1 ELSE 0 END) > 1
  ) g;

  SELECT count(*), count(DISTINCT (user_id, measured_at, raw_hex)) INTO total_rows, distinct_keys
    FROM scale_raw_samples;
  predicted := total_rows - distinct_keys;

  SELECT count(DISTINCT user_id) INTO accounts FROM (
    SELECT user_id FROM scale_raw_samples
     GROUP BY user_id, measured_at, raw_hex
    HAVING count(*) > 1
  ) g;

  -- Every row that has a lower-id twin goes; the lowest id in each group has none, so it stays.
  DELETE FROM scale_raw_samples d
   USING scale_raw_samples k
   WHERE d.user_id = k.user_id
     AND d.measured_at = k.measured_at
     AND d.raw_hex = k.raw_hex
     AND d.id > k.id;
  GET DIAGNOSTICS deleted = ROW_COUNT;

  IF deleted <> predicted THEN
    RAISE EXCEPTION 'LA-71: deleted % scale_raw_samples rows, predicted %; rolled back', deleted, predicted;
  END IF;

  CREATE UNIQUE INDEX scale_raw_samples_user_measured_raw_uq
    ON scale_raw_samples (user_id, measured_at, raw_hex);

  EXECUTE format(
    'COMMENT ON INDEX scale_raw_samples_user_measured_raw_uq IS %L',
    format('LA-71 (#2196), built %s: deleted %s exact duplicate row(s) across %s account(s), of %s rows; %s group(s) differed only in decoded',
           to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'), deleted, accounts, total_rows, decoded_diff));

  RAISE NOTICE 'LA-71: deleted % exact duplicate scale_raw_samples row(s) across % account(s), of % rows (predicted %); % group(s) differed only in decoded',
    deleted, accounts, total_rows, predicted, decoded_diff;
END $$;
