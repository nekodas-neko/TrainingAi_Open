-- Q-536: merge the clock "epochs" that a history re-drain opened, which were never resets.
--
-- On 2026-08-17 Health showed 43 nights with midday bedtimes (12:07 pm, 11:16 am). The cause was
-- not a timezone bug and not an ambiguous ds lookup. It is this:
--
-- After a re-pair the app holds no sync cursor, so the ring replays days of buffered history. Those
-- replayed `ds` values look like a counter regression, and `isClockEpochReset` (lib/oura-ble/clock.ts)
-- opens a new epoch on any regression beyond one hour. `robustOffsetMs` then estimates that epoch's
-- clock offset at the p10 of anchor lag — an estimator justified by a steady-state measurement
-- (its own comment: n=99, p0→p10 spans 1.4 min). In a re-drain burst that assumption fails outright:
-- over 90% of the anchors carry backlog lag, so p10 lands **14.16 h** inside it. The new epoch then
-- becomes `currentEpoch(anchors)`, and `aggregateOuraRawSamples` resolves *every* ds against
-- `currentEpoch` — so one re-pair re-times the whole sleep history. The 2026-08-17 full redecode is
-- what applied it: 49 nights carry that day's `updated_at`, every other night carries its own.
--
-- The ring clock never reset. Measured on production anchors:
--   * the MINIMUM lag (`anchor_utc − anchor_ds×100`, bounded below by the true offset because an
--     event cannot be received before it happened) agrees across all four epochs to within **50 s**,
--     over three weeks and 5,374 anchors;
--   * the counter is continuous — the first sample of epoch 3 above epoch 2's ceiling is
--     ds 37,112,507 against 37,112,321, a gap of **18.6 s**;
--   * the implied ring origin, 2026-07-05 07:47 UTC, matches the 2026-07-07 BLE re-key.
-- Nothing ever dropped to near zero, which is what clock.ts says a real reset does.
--
-- WHY THIS MERGES BY MEASURED OFFSET AND NOT BY user_id OR epoch NUMBER.
-- Scoping to one user would need that user's id hardcoded here, and `pg_stat_user_tables` is too
-- stale to prove they are the only ring owner (it estimated 6 anchor rows against 5,374 actual).
-- Scoping to "epochs 1 and 3" would encode this incident rather than the rule. So the criterion is
-- the evidence itself: two epochs belong to the same ring clock when their minimum anchor lag
-- agrees. A re-drain leaves that minimum untouched (it is the promptly-delivered anchors that set
-- it); a genuine re-key restarts the counter, moving the origin — and therefore the minimum lag —
-- by however long the ring had been running, which is weeks. The 10-minute tolerance below sits 12×
-- above the observed 50 s spread and orders of magnitude below any real re-key gap, so a true reset
-- is left alone. Merging is downward only, into the lowest epoch of the matching group.
--
-- Idempotent: re-running finds every epoch already equal to its group's minimum and updates nothing.
-- Cheap: the anchors table is ~5,400 rows, so this finishes in well under a second.
-- Non-destructive: no row is deleted and no `body_hex` is touched, so a corrected decoder can always
-- re-derive. `oura_raw_samples.epoch` is a label, and this migration only relabels.
--
-- AFTER DEPLOY: a full-history Redecode is still required to rewrite the 43 stored nights. The
-- rollup's own incremental window is 35 days and the damage spans 44 (2026-07-04 → 2026-08-17), so
-- clearing the watermark below is not by itself enough to reach the oldest nights.
--
-- The misdetection that caused this is Q-314 — until that lands, every re-pair reopens it.

-- ⚠️ REWRITTEN 2026-08-17, SAME DAY, BEFORE THIS EVER APPLIED ANYWHERE THAT MATTERS.
-- The first version also relabelled `oura_raw_samples` in this transaction — 434,707 rows on the
-- 667 MB table — and the pool sets `statement_timeout = 15s` (`lib/data/postgres/client.ts`). It
-- timed out on every boot, the whole implicit transaction rolled back, and `ensureSchema` logged
-- the failure and carried on, so production sat on four epochs and the owner's redecode changed
-- nothing. It was verified locally against an 8-row fixture, which proved correctness and said
-- nothing at all about scale.
--
-- Editing this file rather than superseding it is deliberate and safe **only because it never
-- reached `schema_migrations` in production**. Do not take it as licence to edit an applied
-- migration; `ensureSchema` tracks by filename, so an edit to an applied file never runs.
--
-- The sample relabel moved to migration 190. It is NOT load-bearing for the repair:
-- `oura_raw_samples.epoch` is written at ingest (`adapter.ts:4888`) and read by **nothing** — the
-- offset every timestamp depends on comes from `oura_ble_clock_anchors` alone, via
-- `currentEpoch(anchors)` and `robustOffsetMs(anchors)`. Splitting it out means the expensive,
-- inert half can no longer roll back the cheap, load-bearing one.
SET LOCAL statement_timeout = '5min';

-- One canonical epoch per group of same-clock epochs, per user.
CREATE TEMP TABLE q536_epoch_merge ON COMMIT DROP AS
WITH min_lag AS (
  SELECT user_id,
         epoch,
         MIN(EXTRACT(EPOCH FROM anchor_utc) * 1000 - anchor_ds * 100) AS min_lag_ms
  FROM oura_ble_clock_anchors
  GROUP BY user_id, epoch
)
SELECT a.user_id,
       a.epoch AS from_epoch,
       MIN(b.epoch) AS to_epoch
FROM min_lag a
JOIN min_lag b
  ON b.user_id = a.user_id
 AND ABS(a.min_lag_ms - b.min_lag_ms) <= 600000   -- 10 minutes, see rationale above
GROUP BY a.user_id, a.epoch;

UPDATE oura_ble_clock_anchors a
   SET epoch = m.to_epoch
  FROM q536_epoch_merge m
 WHERE a.user_id = m.user_id
   AND a.epoch = m.from_epoch
   AND a.epoch <> m.to_epoch;

-- The watermark stores the epoch its `last_rolled_ds` was measured in, and a watermark from a
-- different epoch is ignored rather than trusted (migration 184). Relabelling the epochs underneath
-- it would make a stale watermark look current, so drop it for every user whose epochs moved and let
-- the next rollup re-derive from the full window.
DELETE FROM oura_rollup_state s
 WHERE EXISTS (
   SELECT 1 FROM q536_epoch_merge m
    WHERE m.user_id = s.user_id
      AND m.from_epoch <> m.to_epoch
 );
