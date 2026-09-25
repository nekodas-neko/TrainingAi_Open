# 2026-09-25 — RV-182 ①: 8% of the database doing nothing, and a correction to the other 9%

**Branch:** `rv182-ingest-work` · **Lane A**

## What shipped

An idempotent `UPDATE oura_raw_samples SET measured_at = … WHERE measured_at IS NULL` ran on every
ingest batch. Its comment called it *"cheap no-op once caught up"*. Re-measured against production
before removing it:

- **4,932 calls · 90 s · 8.0% of all database time · 0 rows updated.**
- `measured_at` has **0 nulls** in ~192,772 rows.

No index serves that predicate, so each call seq-scanned the hot window to find the nothing it was
always going to find — and it is most of why `oura_raw_samples` shows a billion sequential tuple
reads.

**Deleting it is safe because a NULL can no longer be written**, and the argument is short enough to
check: `oura_raw_samples` has exactly one insert path (`insertOuraRawSamples`); `anchor` there is
non-null by construction, because having no anchors forces `epochNow == null`, which forces
`shouldObserve`, which writes one before the insert; so `measuredAt()` always returns a Date. The
only other writer sets `decoded`, and migration 190 sets `epoch`.

**The column is NOT dropped.** That is a data-dropping migration and the owner's call.

## An argument nothing checks is a comment

The deletion rests entirely on that invariant, so it is now pinned by
`lib/data/postgres/__tests__/oura-raw-sample-measured-at.test.ts` — five cases over real Postgres,
covering the paths a NULL could come from: an ordinary batch, **the very first batch a user ever
sends** (no anchor exists yet, which is the case the backfill genuinely served once), a batch that
opens a clock epoch, a history re-drain whose ds values sit far below the epoch high-water mark, and
a mixed sequence including a byte-identical re-send.

Mutation pass: writing `measuredAt: null` at the insert kills all five; an equivalent control
(arrow → function expression) survives. A third mutation — taking the anchor from the pre-batch read
rather than the one this batch just wrote — **also survived, and that is correct rather than a gap**:
it produces a differently-*dated* row, not a NULL one, and the statement being deleted only ever
touched NULLs. The test header says so, so nobody later mistakes it for a dating-accuracy test.

## The correction: the other 9% is not where the entry put it

RV-182's second item reads the clock-anchor cost as one number across three functions and proposes
`ORDER BY epoch DESC, anchor_ds DESC LIMIT 1` plus an index on `(user_id, anchor_utc DESC)`.
Measured separately:

| function | calls | mean | total | share |
|---|---|---|---|---|
| `getOuraClockAnchors` (full series) | 2,190 | 48.45 ms | **106 s** | **9.4%** |
| `getOuraClockEpochHead` (the `GROUP BY`) | 4,942 | 1.80 ms | 9 s | 0.8% |
| `getNewestOuraClockAnchorByUtc` (unindexed `anchor_utc`) | 4,942 | 1.71 ms | 8 s | 0.8% |

The two the proposed fix targets are **already cheap** — 1.7–1.8 ms against a 12,582-row table — so
the index and the `LIMIT 1` would buy at most 1.6% and leave the 9.4% exactly where it is. Worse,
the expensive one cannot become `LIMIT 1`: **LA-139 (#1602, merged earlier today) deliberately moved
four call sites onto the full series** because a single newest anchor was the wrong offset. Applying
the entry as written would undo a correctness fix to chase a saving it would not make.

**What the 9.4% actually is turns out to be RV-181's shape again.** `resolveDsToMs` needs *one
scalar per epoch* — the 10th-percentile lag from `robustOffsetMs` — and rebuilds it from every
anchor row on every request: 2,190 calls × 9,735 rows to produce one number, against **1 distinct
epoch** in 12,582 rows. So the fix is the order statistic in SQL, using
`ORDER BY lag OFFSET floor(n*0.1) LIMIT 1` rather than `percentile_disc`, which disagrees with
`Math.floor(n*0.1)` at small n — the same trap RV-181 hit and documented.

`resolveMsToDs` is the genuine hold-out: it interpolates between the anchors *bracketing* an instant,
so it wants a two-row windowed query, not an aggregate. Six call sites in total, plus thinning the
inserts (4,942 anchors, one per ingest batch, all describing one linear clock) as the complementary
half.

**That is a second substantial change and it is not in this PR.** Shipping the deletion alone gets
8% back now at low risk; starting a six-call-site refactor on the end of it would have been a
speculative push. The design above is written into the entry so the next session starts from it
rather than re-deriving it — and, more to the point, does not build the version that was written
down.

## Verification

- `tsc` clean, **1054 test files / 9816 tests passed**, Custom Rules 78 of 78, lint 0 errors.
- The production measurements above are reads against the live database, not a deployed run.

**Not exercised:** nothing device-, native- or safe-area-shaped is touched. The ingest path itself is
only exercised against local Postgres — the real path runs from the ring over BLE, and the on-device
half of it is unchanged by this diff.
