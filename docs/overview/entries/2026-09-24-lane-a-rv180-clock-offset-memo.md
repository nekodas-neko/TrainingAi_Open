# RV-180 — converting one ring timestamp re-sorted every clock anchor, once per row

**Branch:** `lane-a/rv180-clock-offset-memo` · **Lane A** · 2026-09-24

`resolveDsToMs` did two O(n) passes over the anchor set on **every call**: resolve the current epoch
by scanning all anchors, then filter to that epoch and sort the result for the robust offset. No
memo. Production holds **12,396 anchors**, all in epoch 0, growing 150–300 a day — and the function
is called inside three separate `rows.map`s.

## Measured, both sides

Benchmarked against the real production shape (12,396 anchors, `device-metrics`' default 3-day
window of 58,856 rows), on sandbox CPU:

| | per call | the 58,856-row window |
|---|---:|---:|
| before | **2.308 ms** | **135.8 s** of synchronous CPU |
| after | 0.0002 ms | **0.01 s** |

The entry estimated 3.0 ms and 177 s; this machine measures 2.31 and 136. Different CPU, same
conclusion — and the conclusion is the point: 136 seconds of *synchronous* work on the single Node
process blocks every other request for the duration. That is the shape DV-13 reported, with four
admin requests hanging past 90 s and `/api/version` timing out from another machine for 8 minutes.

## The fix

A `WeakMap` keyed on the **anchor array's identity**, holding the resolved epoch and a per-epoch
offset map.

Identity is the right key because every caller reads its anchors once and passes the same array for
every row of the batch — so identity is precisely "this batch", with no key to build and nothing to
invalidate. `WeakMap` means a finished request's entry is collected along with its array rather than
accumulating in a cache nobody prunes.

An epoch with no anchors caches `null` rather than being left absent, so a caller asking for the
same empty epoch once per row does not pay the filter each time — the removed cost wearing a hat.

The assumption, written into the source rather than left implicit: the array is not mutated in
place between calls. Every current caller builds one from a query and treats it as read-only. A
defensive copy would reintroduce the per-row cost this exists to remove.

## Mutation pass

Speed is not what the tests assert — a memo is worth nothing unless the answer is identical, so the
suite pins equivalence and the cache's boundaries.

| # | mutation | result |
|---|---|---|
| 1 | one offset cached for the whole array, ignoring epoch | killed (3) |
| 2 | an empty epoch returns 0 instead of null, uncached | killed (2) |
| 3 | memo keyed on array length, so equal-sized batches collide | killed (5) |
| C | `memoFor` written as if/else instead of early-return | survived (correct) |

Mutation 3 is the one worth having: keying on anything but identity looks equivalent until two
batches happen to be the same size.

## What this does not do

Two of the entry's three fix items are **not** here, deliberately, and both are separate entries:
reading one offset per epoch in SQL rather than the whole table (**RV-182**), and the row cap DV-13
already owes. Per-row cost is now O(1), which is what made the route unusable.

## Failure surfaces not exercised

No device, no production. The benchmark reproduces the anchor count and row count from production
readings but runs on sandbox CPU, so the absolute seconds are indicative and the ratio is the
result. **`/admin/oura-ble` stays closed until DV-13's own pass test runs on the S25** — RV-186
carries that.
