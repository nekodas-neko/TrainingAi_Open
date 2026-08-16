# 2026-08-08 — The hottest scan in the database was reading 3,297 rows to get three numbers (Q-143)

**Branch:** `perf/oura-clock-anchor-scoping` · **Domain:** `platform`, `devices` · no version bump
(server-side read pattern, nothing user-visible)

## What was wrong

`getOuraClockAnchors()` selects every anchor row for the user, unbounded. In production that made it
the single hottest scan in the database: **17,045 sequential scans reading 45,278,531 tuples** from a
3,297-row table — roughly 2,657 rows per scan, seventeen thousand times.

**The entry's title said "on every rollup". It is worse than that: the hot caller is
`insertOuraRawSamples`, so it runs on every ingest batch.** That is where the 17,045 comes from —
the rollup, the backfill preview and the step-counter export together are nowhere near that count.

An index would not have helped and was explicitly not added. The query returns all rows for the only
user, so a sequential scan is the correct plan *for that query*. The defect is the call pattern: the
anchor table has no pruning, so it grows for the life of the ring while every batch re-reads all of
it. Cost linear in a number that only goes up.

## What it actually needed

Three numbers:

- `epochNow` — `currentEpoch(anchors)`, which is just `max(epoch)` (`lib/oura-ble/clock.ts:52-55`).
- `epochMaxDs` — the highest `anchorDs` **within that epoch**, for the clock-reset check.
- the newest anchor by `anchorUtcMs`, to stamp `measured_at`.

The first two are one aggregate row (`GROUP BY epoch ORDER BY epoch DESC LIMIT 1`); the third is one
row (`ORDER BY anchor_utc DESC LIMIT 1`). Both now issue in parallel via `Promise.all`, and the cost
is flat in anchor count.

## The subtlety worth knowing

`epochMaxDs` must be the max **within the newest epoch**, not the overall max. After a ring re-key or
dead battery the counter restarts, so epoch 1's ds values sit far *below* epoch 0's. A plain
`max(anchor_ds)` would keep returning epoch 0's high-water mark, `isClockEpochReset` would fire on
every subsequent batch, and the ring would open a new epoch per drain forever.

That is not hypothetical — it is the exact failure Q-139 and migration 161 exist to prevent, so the
test asserts it directly and I confirmed it fails on a planted version of that mistake.

## Verification

- `tsc --noEmit` clean · `eslint` clean (11 pre-existing unused-import warnings in `adapter.ts`,
  0 errors) · full suite **416 files / 3279 tests** green.
- `oura-ble-clock-epochs.test.ts` — the existing coverage for this path — passes unchanged.
- New `oura-clock-anchor-scoping.test.ts` pins the two reads as **equivalent to the reduce they
  replaced**, recomputing the old expression from the full anchor list and comparing: across a
  forward drain, across a clock reset, on the empty case, and on user scoping. Equivalence rather
  than "it works" is deliberate — it is the whole safety argument for touching the ring clock.
- Planted a regression (order the epoch head by `max(anchor_ds)` instead of by `epoch`) and confirmed
  two tests go red, then restored and confirmed green.

**Not exercised: the device.** This is the ring ingest path, and the sandbox has no ring. What is
verified is that the new reads return exactly what the old code computed, against a real Postgres —
not that a live BLE drain behaves identically end to end. An on-device drain is the honest bar before
calling this closed, and `projectOverview.md` says so.
