-- Q-536, second half: bring `oura_raw_samples.epoch` into line with the anchors migration 189
-- already merged.
--
-- SPLIT OUT OF 189 DELIBERATELY, AND THE REASON IS THE WHOLE POINT OF THIS FILE.
-- 189 originally did both in one transaction. The anchors half is ~5,400 rows; this half is
-- ~434,700 on the 667 MB `oura_raw_samples`. The pool sets `statement_timeout = 15s`
-- (`lib/data/postgres/client.ts`), so the combined migration timed out on every boot, the whole
-- implicit transaction rolled back, and `ensureSchema` logged it and moved on — leaving production
-- on four epochs while the owner's redecode faithfully reproduced the wrong times.
--
-- The two halves are not equally important, which is what makes splitting them correct rather than
-- merely convenient. `oura_raw_samples.epoch` is written at ingest (`adapter.ts:4888`) and read by
-- **nothing**: the offset every derived timestamp depends on comes from `oura_ble_clock_anchors`,
-- via `currentEpoch(anchors)` and `robustOffsetMs(anchors)`. So 189 is load-bearing and cheap, and
-- this file is expensive and inert. Separating them means this one cannot roll back that one.
--
-- Why relabel at all, then? Because the column exists precisely so a future per-row resolver can
-- use it (`clock.ts`: "Historical samples carry their own `epoch` column for exactly this reason").
-- Leaving samples labelled 1/2/3 while every anchor says 0 would hand that future resolver labels
-- that disagree with the clock they are supposed to index — a trap set for whoever builds it.
--
-- `epoch` is in no index on this table (the four are: the `(user_id, ds, tag, body_hex)` unique,
-- `idx_oura_raw_samples_user_measured`, `oura_raw_samples_user_tag_ts`, and the pkey), so unlike the
-- `measured_at` re-stamp that caused the disk_full incident these updates are HOT-eligible and do
-- not rewrite index entries. Still a large write: expect it to take minutes, not seconds.
--
-- If this times out anyway it rolls back alone, 189 stands, sleep times stay correct, and the only
-- consequence is that the labels remain inconsistent until someone raises the budget below.
SET LOCAL statement_timeout = '30min';

-- 189's temp table was ON COMMIT DROP and its transaction is long gone, so the from→to mapping has
-- to be re-derived. The obvious re-derivation is wrong and worth naming: `MIN(epoch) GROUP BY
-- user_id` over the anchors would also collapse a user whose epochs 189 deliberately LEFT SPLIT —
-- a genuine re-key — destroying the exact distinction the clock epochs exist to record.
--
-- So this only touches users for whom the answer is unambiguous: those left with **exactly one**
-- surviving anchor epoch. For them, any sample still carrying a different label is carrying one 189
-- merged away, and there is only one thing it can mean. A user with two or more surviving epochs is
-- skipped entirely — their labels stay as they are, because nothing here can tell which surviving
-- epoch a given sample belonged to, and guessing would be worse than leaving it inconsistent.
UPDATE oura_raw_samples r
   SET epoch = sole.epoch
  FROM (
    SELECT user_id, MIN(epoch) AS epoch
      FROM oura_ble_clock_anchors
     GROUP BY user_id
    HAVING COUNT(DISTINCT epoch) = 1
  ) sole
 WHERE r.user_id = sole.user_id
   AND r.epoch <> sole.epoch;
