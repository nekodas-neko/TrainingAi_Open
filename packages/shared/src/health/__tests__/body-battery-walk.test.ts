import { describe, it, expect } from 'vitest'
import { walkBodyBattery, type BatteryWalkParams } from '../body-battery-walk'

// The walk was inline in `/api/body-battery` and could only be exercised through a DB-backed route
// test, which is why its arithmetic had never been pinned directly. Every expected value below is
// hand-computed from the formula rather than captured from a run — a golden-file capture would
// happily bless a regression.
//
// Reference figures: restingHr 50, reserve 100 (so hrMax 150), threshold 0.05 of reserve — i.e. the
// charge ceiling sits at 55 bpm.
const P: BatteryWalkParams = {
  anchor: 50,
  wakeTime: 0,
  restingHr: 50,
  reserve: 100,
  restThreshold: 0.05,
  chargeRate: 0.2,
  drainRate: 0.6,
  stressDrainRate: 0.2,
  gapHoldMin: 30,
  sampleCapMin: 7,
  stressAt: () => null,
}
const MIN = 60_000

describe('walkBodyBattery — charge and drain', () => {
  it('charges at the full rate when HR sits exactly at resting', () => {
    // hrr = 0 → delta = 0.2 × (1 − 0/0.05) × 5 min = 1.0
    const r = walkBodyBattery([{ tsMs: 5 * MIN, bpm: 50 }], P)
    expect(r.battery).toBeCloseTo(51, 6)
    expect(r.charged).toBeCloseTo(1, 6)
    expect(r.drained).toBe(0)
  })

  it('charges nothing exactly at the ceiling — the boundary is charge-neutral, not a step', () => {
    // 55 bpm → hrr = 0.05 = threshold → delta = 0.2 × (1 − 1) × dt = 0. It takes the charge branch
    // (`<=`), so this pins that the two branches meet at zero rather than jumping.
    const r = walkBodyBattery([{ tsMs: 5 * MIN, bpm: 55 }], P)
    expect(r.battery).toBeCloseTo(50, 6)
    expect(r.charged).toBeCloseTo(0, 6)
    expect(r.drained).toBe(0)
  })

  it('drains in proportion to reserve above the threshold', () => {
    // hrr = 0.5 → delta = −0.6 × (0.5 − 0.05) × 5 = −1.35
    const r = walkBodyBattery([{ tsMs: 5 * MIN, bpm: 100 }], P)
    expect(r.battery).toBeCloseTo(48.65, 6)
    expect(r.drained).toBeCloseTo(1.35, 6)
    expect(r.charged).toBe(0)
  })

  it('clamps hrr at 1, so a HR above hrMax cannot drain faster than the ceiling', () => {
    // 400 bpm clamps to hrr = 1 → delta = −0.6 × 0.95 × 5 = −2.85, same as exactly hrMax.
    const above = walkBodyBattery([{ tsMs: 5 * MIN, bpm: 400 }], P)
    const atMax = walkBodyBattery([{ tsMs: 5 * MIN, bpm: 150 }], P)
    expect(above.battery).toBeCloseTo(47.15, 6)
    expect(above.battery).toBeCloseTo(atMax.battery, 6)
  })
})

describe('walkBodyBattery — time handling', () => {
  it('holds the level steady across a gap longer than gapHoldMin, but keeps the timeline', () => {
    const r = walkBodyBattery([{ tsMs: 40 * MIN, bpm: 50 }], P)
    expect(r.battery).toBe(50)
    expect(r.charged).toBe(0)
    // The point is still emitted, so the chart does not draw a straight line through the gap.
    expect(r.series).toEqual([{ t: 0, v: 50 }, { t: 40 * MIN, v: 50 }])
  })

  it('caps a single sample\'s dt so sparse data cannot spike one delta', () => {
    // 20 min is under gapHoldMin, so it integrates — but at the 7-minute cap: 0.2 × 1 × 7 = 1.4
    const r = walkBodyBattery([{ tsMs: 20 * MIN, bpm: 50 }], P)
    expect(r.battery).toBeCloseTo(51.4, 6)
  })

  it('ignores samples before wake and counts only the ones that drove the arc', () => {
    const r = walkBodyBattery(
      [{ tsMs: -10 * MIN, bpm: 200 }, { tsMs: 5 * MIN, bpm: 50 }],
      P,
    )
    // The pre-wake 200 bpm would have drained hard had it been integrated.
    expect(r.battery).toBeCloseTo(51, 6)
    expect(r.sampleCount).toBe(1)
  })

  it('skips a zero or negative dt rather than dividing by it', () => {
    const r = walkBodyBattery([{ tsMs: 0, bpm: 200 }, { tsMs: 0, bpm: 200 }], P)
    expect(r.battery).toBe(50)
  })
})

describe('walkBodyBattery — stress drain', () => {
  it('adds stress drain on top of a charging sample, and books it to both totals', () => {
    // charge 0.2 × 1 × 5 = 1.0; stress extra = 0.2 × 0.5 × 5 = 0.5 → net +0.5
    const r = walkBodyBattery([{ tsMs: 5 * MIN, bpm: 50 }], { ...P, stressAt: () => -0.5 })
    expect(r.battery).toBeCloseTo(50.5, 6)
    expect(r.charged).toBeCloseTo(1, 6)      // the HR half is still a full charge
    expect(r.drained).toBeCloseTo(0.5, 6)
    expect(r.stressDrained).toBeCloseTo(0.5, 6)
  })

  it('ignores a positive stress level — only below-baseline adds drain', () => {
    const r = walkBodyBattery([{ tsMs: 5 * MIN, bpm: 50 }], { ...P, stressAt: () => 0.8 })
    expect(r.battery).toBeCloseTo(51, 6)
    expect(r.stressDrained).toBe(0)
  })

  it('a null stress lookup is identical to no stress series at all', () => {
    const withNull = walkBodyBattery([{ tsMs: 5 * MIN, bpm: 90 }], { ...P, stressAt: () => null })
    const without = walkBodyBattery([{ tsMs: 5 * MIN, bpm: 90 }], P)
    expect(withNull.battery).toBeCloseTo(without.battery, 6)
    // This is what makes the TN-4 guard safe: a failed stress build leaves an empty series, and an
    // empty series is exactly this case.
    expect(withNull.stressDrained).toBe(0)
  })
})

describe('walkBodyBattery — bounds', () => {
  it('never exceeds 100', () => {
    const r = walkBodyBattery([{ tsMs: 5 * MIN, bpm: 50 }], { ...P, anchor: 99.5 })
    expect(r.battery).toBe(100)
  })

  it('never falls below 0', () => {
    const r = walkBodyBattery([{ tsMs: 5 * MIN, bpm: 100 }], { ...P, anchor: 1 })
    expect(r.battery).toBe(0)
  })
})

describe('the threshold is expressible as a bpm offset — what TN-2 needs', () => {
  // TN-2 replaces the reserve-fraction offset with an explicit bpm offset above resting HR, so the
  // charge window stops shrinking when `hrMax` is re-estimated. This pins that the substitution is
  // arithmetic-only: passing `offsetBpm / reserve` as the threshold puts the ceiling at exactly
  // `restingHr + offsetBpm`, so no other change to this function is required.
  const OFFSET_BPM = 10

  it('puts the charge ceiling at restingHr + offset, whatever the reserve', () => {
    for (const reserve of [80, 100, 137]) {
      const p = { ...P, reserve, restThreshold: OFFSET_BPM / reserve }
      // Exactly at the ceiling: charge-neutral.
      expect(walkBodyBattery([{ tsMs: 5 * MIN, bpm: 60 }], p).battery).toBeCloseTo(50, 6)
      // One bpm under: charging.
      expect(walkBodyBattery([{ tsMs: 5 * MIN, bpm: 59 }], p).battery).toBeGreaterThan(50)
      // One bpm over: draining.
      expect(walkBodyBattery([{ tsMs: 5 * MIN, bpm: 61 }], p).battery).toBeLessThan(50)
    }
  })

  it('is immune to hrMax re-estimation, which the reserve-fraction form is not', () => {
    // The 2026-08-05 step: hrMax fell 187 → 168, so reserve fell with it. Under the CURRENT form
    // the ceiling moves; under the offset form it does not. This is the whole point of TN-2.
    const wide = { ...P, reserve: 137 }
    const narrow = { ...P, reserve: 118 }
    const ceiling = (p: BatteryWalkParams) => {
      for (let bpm = 50; bpm < 120; bpm++) {
        if (walkBodyBattery([{ tsMs: 5 * MIN, bpm }], p).battery < 50) return bpm
      }
      return -1
    }
    // Reserve-fraction: the ceiling shifts when reserve changes.
    expect(ceiling(wide)).not.toBe(ceiling(narrow))
    // Explicit offset: it does not.
    expect(ceiling({ ...wide, restThreshold: OFFSET_BPM / 137 }))
      .toBe(ceiling({ ...narrow, restThreshold: OFFSET_BPM / 118 }))
  })
})
