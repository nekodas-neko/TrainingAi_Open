-- Q-541 — the cold tier for packed raw BLE frames.
--
-- `oura_raw_samples` spends ~328 bytes per row to store a ~12-byte ring frame. That 27× overhead,
-- not the data, is 93% of the largest table in this database, and it is what caused the 2026-08-17
-- `disk_full` outage: a full `measured_at` re-stamp rewrote 681,005 rows with **zero** HOT updates,
-- doubling the table without adding a single frame.
--
-- Measured on production (1,098,956 frames, 2026-08-17): grouping by `(epoch, tag, ds/864000)` gives
-- **968 blobs** — a 1,135× row reduction, ~22.5 blobs/day, 13 MB of actual frame payload. Projected
-- steady state ~70 MB total against ~7.5 MB/day of growth today, which is what makes the stock
-- 500 MB volume a home rather than somewhere the database passes through on its way up.
--
-- TWO TIERS, NOT AN IN-PLACE REPACK. `oura_raw_samples` and the ingest path are **not touched** by
-- this migration or by anything in Q-541. The ingest path is the one thing in this pipeline that
-- must never break — the history cursor's safety rests on it, and a botched change silently loses
-- drained spans forever (ops-doc I18, I21). So the hot table keeps its schema, its `ON CONFLICT DO
-- NOTHING` dedup and its `(user_id, ring_timestamp_ds, tag, body_hex)` unique key exactly as they
-- are; a background packer seals everything older than the hot window into this table instead.
--
-- WHAT IS DELIBERATELY NOT A COLUMN HERE:
--   * `event_name` — a pure function of `tag` (30 values, pinned by the Kotlin/TS parity test).
--   * `measured_at` — derived at read time from the clock anchors, which is already how the rollup
--     resolves time. **This is what deletes the re-stamp operation**: a future clock correction then
--     changes a derivation rather than 1.1M rows, so the mechanism behind the outage stops existing.
--   * `decoded` — already NULL on every row; decoding happens in memory from the body.
--   * The hex — the blob is `bytea` and stores bytes, which absorbs the `text` → `bytea` half of
--     Q-540. **Do not also run that standalone migration**; it would be the same rewrite twice.
--
-- Nothing here deletes a frame, and the `CLAUDE.md` archival rule stands unchanged. This migration
-- is additive only: it creates an empty table. The packer that fills it is admin-triggered, and its
-- delete step is gated on a proven-equal re-read (plan §6).
CREATE TABLE IF NOT EXISTS oura_raw_packed (
  user_id     UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The clock epoch the ds values belong to. In the bucket key because `ring_timestamp_ds` is a
  -- counter since the ring's own epoch and is only comparable within one — see Q-536, where a
  -- spurious epoch re-timed the whole sleep history.
  epoch       INTEGER NOT NULL,
  tag         SMALLINT NOT NULL,
  -- Floor(ring_timestamp_ds / 864000) — one day of ring time. NOT a calendar day: the ds→wall-clock
  -- derivation can change (correcting it is exactly what Q-536 did), and a bucket keyed on the
  -- derived day would have to be repacked when it did. A bucket keyed on raw ds never moves.
  ds_bucket   BIGINT  NOT NULL,
  frame_count INTEGER NOT NULL,
  min_ds      BIGINT  NOT NULL,
  max_ds      BIGINT  NOT NULL,
  -- SHA-256 of `blob`, written by the packer and re-checked by its verify step before any hot row is
  -- deleted. The archive's integrity check, not a dedup key.
  body_sha256 TEXT    NOT NULL,
  blob        BYTEA   NOT NULL,
  packed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, epoch, tag, ds_bucket)
);

-- The read shape every consumer uses: one user's frames for a set of tags over a ds range. The PK
-- already leads with user_id but has `tag` ahead of `ds_bucket`, which is wrong for a range scan
-- across tags, so this covers the range-first case.
CREATE INDEX IF NOT EXISTS idx_oura_raw_packed_user_bucket
  ON oura_raw_packed (user_id, ds_bucket);
