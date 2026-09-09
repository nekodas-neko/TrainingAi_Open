import { describe, expect, it } from 'vitest'
import { restByPrescription, deltaPct, type RestSet } from '../rest-prescription'

/** `n` sets at one prescription, each taking `actual` seconds. */
function at(plannedRestSec: number, actual: number, n: number): RestSet[] {
  return Array.from({ length: n }, () => ({ plannedRestSec, restTimeSec: actual }))
}

/**
 * The production shape (Q-300, measured over 344 sets): prescribed rest spans 60–187 s while actual
 * spans 65–133 s, and at the shortest prescription the owner rests LONGER than asked.
 */
const PRODUCTION: RestSet[] = [
  ...at(60, 75, 40),
  ...at(90, 65, 44),
  ...at(120, 110, 121),
  ...at(187, 133, 9),
]

describe('restByPrescription — the pairs, in prescription order', () => {
  it('reports each prescription against the rest actually taken', () => {
    const s = restByPrescription(PRODUCTION)!
    expect(s.rows).toEqual([
      { plannedSec: 60, actualSec: 75, sets: 40 },
      { plannedSec: 90, actualSec: 65, sets: 44 },
      { plannedSec: 120, actualSec: 110, sets: 121 },
      { plannedSec: 187, actualSec: 133, sets: 9 },
    ])
    expect(s.totalSets).toBe(214)
  })

  it('orders by prescription, not by however the sets arrived', () => {
    const s = restByPrescription([...PRODUCTION].reverse())!
    expect(s.rows.map(r => r.plannedSec)).toEqual([60, 90, 120, 187])
  })

  it('sees the shortest prescription being EXCEEDED, which is the part a "rushing" framing loses', () => {
    const s = restByPrescription(PRODUCTION)!
    expect(deltaPct(s.rows[0])).toBe(25)
    expect(deltaPct(s.rows[1])).toBe(-28)
  })
})

describe('restByPrescription — what it refuses to report', () => {
  it('drops a prescription with too few sets rather than printing a noisy mean', () => {
    const s = restByPrescription([...at(60, 75, 40), ...at(300, 20, 2)])!
    expect(s.rows.map(r => r.plannedSec)).toEqual([60])
  })

  it('ignores a prescription of zero, which is "no rest planned" rather than a target', () => {
    expect(restByPrescription([...at(0, 40, 20)])).toBeNull()
  })

  it('ignores sets with no recorded rest, rather than counting them as zero', () => {
    const s = restByPrescription([
      ...at(120, 110, 10),
      ...Array.from({ length: 50 }, () => ({ plannedRestSec: 120, restTimeSec: null })),
    ])!
    expect(s.rows[0]).toEqual({ plannedSec: 120, actualSec: 110, sets: 10 })
  })

  it('ignores sets with no prescription — most of the history predates the column', () => {
    const s = restByPrescription([
      ...at(120, 110, 10),
      ...Array.from({ length: 90 }, () => ({ plannedRestSec: null, restTimeSec: 88 })),
    ])!
    expect(s.totalSets).toBe(10)
  })

  it('is null when nothing clears the floor', () => {
    expect(restByPrescription([])).toBeNull()
    expect(restByPrescription(at(120, 110, 4))).toBeNull()
  })
})

describe('restByPrescription — compression is three-state, not a boolean', () => {
  it('calls the production shape compressed', () => {
    // 127 s of planned span against 68 s of actual — 0.54.
    expect(restByPrescription(PRODUCTION)!.compressed).toBe(true)
  })

  it('does not call a followed plan compressed', () => {
    const s = restByPrescription([...at(60, 62, 20), ...at(120, 118, 20), ...at(180, 176, 20)])!
    expect(s.compressed).toBe(false)
  })

  it('is NULL on a single prescription — one row has no span to compare', () => {
    // The state that matters: "not enough to say" must not render as "your rest follows the plan".
    const s = restByPrescription(at(120, 60, 40))!
    expect(s.rows).toHaveLength(1)
    expect(s.compressed).toBeNull()
  })

  it('is null when every prescription is the same number', () => {
    const s = restByPrescription([...at(120, 110, 10), ...at(120, 90, 10)])!
    expect(s.compressed).toBeNull()
  })
})

describe('deltaPct', () => {
  it('is signed against the prescription', () => {
    expect(deltaPct({ plannedSec: 60, actualSec: 75, sets: 40 })).toBe(25)
    expect(deltaPct({ plannedSec: 120, actualSec: 60, sets: 40 })).toBe(-50)
    expect(deltaPct({ plannedSec: 90, actualSec: 90, sets: 40 })).toBe(0)
  })
})
