// RV-180 — `resolveDsToMs` recomputed two O(n) steps for every single row.
//
// It resolved the current epoch by scanning all anchors, then filtered them to that epoch and
// sorted the result to take the robust offset — once per call, with no memo. Production holds
// 12,396 anchors (all epoch 0, growing 150–300 a day) and the function is called inside three
// `rows.map`s. Benchmarked against that shape on sandbox CPU: **2.31 ms a call**, so
// `device-metrics`' default 3-day window of 58,856 rows is **136 s of synchronous CPU** on the one
// Node process — the shape DV-13 saw as admin requests hanging past 90 s while `/api/version`
// timed out from another machine. After the memo the same window measures **10 ms total**.
//
// Speed is not what these tests assert. A memo is only worth anything if the answer is identical,
// so what is pinned here is equivalence and the cache's boundaries.
import { describe, it, expect } from 'vitest'
import { resolveDsToMs, currentEpoch, type ClockAnchor } from '../clock'

const anchor = (epoch: number, ds: number, utcMs: number): ClockAnchor =>
  ({ epoch, anchorDs: ds, anchorUtcMs: utcMs }) as ClockAnchor

/** A spread of lags, so the 10th-percentile floor is a real choice rather than the only value. */
const spread = (epoch: number, n: number, baseDs = 1_000_000, baseUtc = 1_700_000_000_000) =>
  Array.from({ length: n }, (_, i) => anchor(epoch, baseDs + i * 7, baseUtc + i * 700 + (i % 13) * 50))

describe('the memo returns exactly what recomputing returns (RV-180)', () => {
  it('agrees with a freshly built array holding the same anchors', () => {
    const anchors = spread(0, 200)
    // A separate array with equal contents cannot share the memo — it is keyed on identity — so
    // this compares the cached path against a cold one rather than against itself.
    const fresh = anchors.map(a => ({ ...a }))

    for (const ds of [1_000_000, 1_000_500, 1_002_000]) {
      expect(resolveDsToMs(ds, anchors), `ds ${ds}`).toBe(resolveDsToMs(ds, fresh))
    }
  })

  it('is stable across repeated calls, which is the whole point', () => {
    const anchors = spread(0, 200)
    const first = resolveDsToMs(1_000_000, anchors)
    for (let i = 0; i < 50; i++) expect(resolveDsToMs(1_000_000, anchors)).toBe(first)
  })

  it('keeps the ds → ms mapping linear at 100 ms per ds', () => {
    const anchors = spread(0, 200)
    const a = resolveDsToMs(1_000_000, anchors)!
    const b = resolveDsToMs(1_000_100, anchors)!
    expect(b - a).toBe(100 * 100)
  })
})

describe('the memo is per epoch, not per array', () => {
  const anchors = [...spread(0, 50), ...spread(2, 50, 5_000_000, 1_800_000_000_000)]

  it('resolves each epoch to its own offset', () => {
    // If one offset were cached for the whole array, the second epoch would inherit the first's.
    const inEpoch0 = resolveDsToMs(1_000_000, anchors, 0)
    const inEpoch2 = resolveDsToMs(1_000_000, anchors, 2)
    expect(inEpoch0).not.toBe(inEpoch2)
  })

  it('defaults to the newest epoch', () => {
    expect(currentEpoch(anchors)).toBe(2)
    expect(resolveDsToMs(5_000_000, anchors)).toBe(resolveDsToMs(5_000_000, anchors, 2))
  })

  it('answers null for an epoch with no anchors, and keeps answering null', () => {
    // Cached as null rather than left absent: a caller asking for the same empty epoch once per row
    // would otherwise pay the filter every time, which is the cost being removed wearing a hat.
    for (let i = 0; i < 5; i++) expect(resolveDsToMs(1_000_000, anchors, 99)).toBeNull()
  })
})

describe('the boundaries the memo must not change', () => {
  it('returns null with no anchors at all', () => {
    expect(resolveDsToMs(1_000_000, [])).toBeNull()
  })

  it('gives two different arrays independent memos', () => {
    // The WeakMap key is the array. Two batches read at different times hold different anchors and
    // must not see each other's offset.
    const early = spread(0, 40, 1_000_000, 1_700_000_000_000)
    const later = spread(0, 40, 1_000_000, 1_700_000_900_000)
    expect(resolveDsToMs(1_000_000, early)).not.toBe(resolveDsToMs(1_000_000, later))
  })

  it('an explicit epoch still wins over the cached default', () => {
    const anchors = [...spread(0, 30), ...spread(1, 30, 3_000_000, 1_750_000_000_000)]
    expect(resolveDsToMs(1_000_000, anchors)).toBe(resolveDsToMs(1_000_000, anchors, 1))
    expect(resolveDsToMs(1_000_000, anchors, 0)).not.toBe(resolveDsToMs(1_000_000, anchors, 1))
  })
})
