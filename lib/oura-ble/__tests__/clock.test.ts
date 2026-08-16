// Q-23 §1 / Q-22 §2: the single mutable anchor offset every ring timestamp by one row's
// lag, and a ring clock reset silently zeroed every day after it. These pin the replacement.
import { describe, it, expect } from 'vitest'
import {
  resolveDsToMs, resolveMsToDs, currentEpoch, isClockEpochReset,
  EPOCH_REGRESSION_TOLERANCE_DS, type ClockAnchor,
} from '../clock'

const T0 = Date.UTC(2026, 6, 20, 0, 0, 0)
const a = (epoch: number, anchorDs: number, anchorUtcMs: number): ClockAnchor => ({ epoch, anchorDs, anchorUtcMs })

describe('resolveDsToMs', () => {
  it('returns null with no observations rather than inventing a time', () => {
    expect(resolveDsToMs(1000, [])).toBeNull()
  })

  it('extrapolates from a single observation at the fixed 100 ms/ds slope', () => {
    const anchors = [a(0, 10_000, T0)]
    expect(resolveDsToMs(9_400, anchors)).toBe(T0 - 60_000) // 600 ds = 60 s earlier
  })

  it('uses the observation nearest the frame, not the newest one', () => {
    // The whole point of keeping observations. A frame drained at 10:00 should be dated from
    // the 10:00 observation even though a 16:00 sync has happened since.
    const near = Date.UTC(2026, 6, 20, 10, 0, 0)
    const far = Date.UTC(2026, 6, 20, 16, 0, 0)
    // The 16:00 sync carries an hour of lag: its newest drained event happened at 15:00, so
    // its ds advanced only 5 h while its wall clock advanced 6. That lag is precisely what
    // the old single-newest-anchor rule spread over every frame in the database.
    const anchors = [a(0, 100_000, near), a(0, 100_000 + 5 * 36_000, far)]
    const resolved = resolveDsToMs(99_000, anchors)!   // 100 s before the near observation
    expect(resolved).toBe(near - 100_000)
    // Dated from the newest observation instead, the same frame lands an hour late.
    expect(far + (99_000 - (100_000 + 5 * 36_000)) * 100).toBe(resolved + 3_600_000)
  })

  // ── Q-139: the slope is NOT derived from the anchors ────────────────────────────────
  // This block replaces a test that asserted the opposite — that 1,000 ds across 110 s of wall
  // clock meant "the ring ran 10% slow" and should be interpolated. It does not. The ring's
  // counter ticks at exactly 100 ms by construction, so that 10 s is 10 s of extra transport lag
  // on the second observation, and treating it as slope is what compressed ring time during a
  // history drain.

  it('applies the fixed 100 ms/ds slope rather than the ratio between two observations', () => {
    // Same fixture as the old interpolation test: 1,000 ds of counter, 110 s of wall clock.
    // Midway by counter is now 50 s after the first observation (fixed slope), not 55 s.
    const t1 = T0 + 110_000
    const anchors = [a(0, 10_000, T0), a(0, 11_000, t1)]
    expect(resolveDsToMs(10_500, anchors)).toBe(T0 + 50_000)
  })

  it('does not compress ring time while the ring drains buffered history', () => {
    // The measured production case (2026-08-07): Δds 17,094 — 28.5 min of ring time — arrived
    // inside 95 s of wall clock because the drain outran the clock. Interpolating between these
    // two anchors squeezed 28.5 min into 95 s, an ~18x compression, and every step window in
    // that span piled into one 60 s block.
    const anchors = [a(0, 100_000, T0), a(0, 117_094, T0 + 95_000)]
    const spanMs = resolveDsToMs(117_094, anchors)! - resolveDsToMs(100_000, anchors)!
    expect(spanMs).toBe(17_094 * 100)          // 28.5 min preserved
    expect(spanMs).toBeGreaterThan(95_000 * 17) // not squeezed into the 95 s of wall clock
  })

  it('stays monotonic in ds — a later counter value never resolves earlier', () => {
    // Interpolation could not promise this across anchors whose lags disagreed, and a step
    // bucket that moves backwards is unrecoverable once resampled.
    const anchors = [a(0, 10_000, T0), a(0, 20_000, T0 + 2_000_000), a(0, 30_000, T0 + 900_000)]
    const resolved = [5_000, 10_000, 15_000, 25_000, 35_000].map(ds => resolveDsToMs(ds, anchors)!)
    for (let i = 1; i < resolved.length; i++) expect(resolved[i]).toBeGreaterThan(resolved[i - 1])
  })

  it('lets the lag floor set the offset, not one late-arriving observation', () => {
    // Nine prompt observations and one that took an hour to arrive. The hour is queueing, not
    // clock error, so it must not drag every timestamp with it — but a raw minimum would let a
    // single early-arriving glitch do the same in the other direction, hence the percentile.
    const prompt = Array.from({ length: 9 }, (_, i) =>
      a(0, 10_000 + i * 1_000, T0 + i * 100_000 + 2_000))
    const late = a(0, 19_000, T0 + 900_000 + 3_600_000)
    const withLate = resolveDsToMs(15_000, [...prompt, late])!
    const withoutLate = resolveDsToMs(15_000, prompt)!
    expect(withLate).toBe(withoutLate)
  })

  it('never resolves a ds against another epoch’s observations', () => {
    // After a reset the counter starts low again. Resolving epoch 1's small ds against
    // epoch 0's anchor is what put post-reset frames weeks in the past.
    const t1 = T0 + 86_400_000
    const anchors = [a(0, 900_000, T0), a(1, 500, t1)]
    expect(resolveDsToMs(400, anchors, 1)).toBe(t1 - 10_000)
    expect(resolveDsToMs(899_000, anchors, 0)).toBe(T0 - 100_000)
  })

  it('returns null for an epoch with no observations', () => {
    expect(resolveDsToMs(400, [a(0, 900_000, T0)], 1)).toBeNull()
  })

  it('keeps ring-vs-ring intervals exact — they are correct today and must stay so', () => {
    // A regression here would be worse than the bug being fixed. Holds across the
    // interpolated span too, where the slope is no longer exactly 100 ms/ds: two ds a fixed
    // distance apart must still be a consistent distance apart in wall clock.
    const anchors = [a(0, 10_000, T0), a(0, 20_000, T0 + 1_000_000)]
    for (const start of [10_500, 12_000, 15_000, 19_000]) {
      const d = resolveDsToMs(start + 300, anchors)! - resolveDsToMs(start, anchors)!
      expect(d).toBeCloseTo(30_000, 6)
    }
  })
})

describe('resolveMsToDs', () => {
  it('round-trips against resolveDsToMs', () => {
    const anchors = [a(0, 10_000, T0), a(0, 20_000, T0 + 1_000_000)]
    for (const ds of [9_000, 10_000, 14_321, 20_000, 25_000]) {
      expect(resolveMsToDs(resolveDsToMs(ds, anchors)!, anchors)).toBeCloseTo(ds, 6)
    }
  })

  it('returns null with no observations', () => {
    expect(resolveMsToDs(T0, [])).toBeNull()
  })
})

describe('epoch detection', () => {
  it('treats a small backwards step as out-of-order delivery, not a reset', () => {
    expect(isClockEpochReset(999_000, 1_000_000)).toBe(false)
    expect(isClockEpochReset(1_000_000 - EPOCH_REGRESSION_TOLERANCE_DS, 1_000_000)).toBe(false)
  })

  it('treats a counter that restarts near zero as a reset', () => {
    expect(isClockEpochReset(500, 9_000_000)).toBe(true)
  })

  it('currentEpoch is the highest observed, and null when there is nothing', () => {
    expect(currentEpoch([])).toBeNull()
    expect(currentEpoch([a(0, 1, T0), a(2, 1, T0), a(1, 1, T0)])).toBe(2)
  })
})
