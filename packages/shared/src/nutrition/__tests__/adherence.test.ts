import { describe, it, expect } from 'vitest'
import { computeAdherenceRatio } from '../adherence'

describe('computeAdherenceRatio', () => {
  it('counts a day adherent only when every required meal type was logged', () => {
    const days = ['2026-07-01', '2026-07-02', '2026-07-03']
    const loggedByDay = new Map([
      ['2026-07-01', 3], // all 3 required types logged
      ['2026-07-02', 2], // only 2 of 3
      ['2026-07-03', 3],
    ])
    expect(computeAdherenceRatio(days, 3, loggedByDay)).toBeCloseTo(2 / 3, 5)
  })

  it('treats a day with no rows at all as non-adherent (map miss = 0)', () => {
    const days = ['2026-07-01', '2026-07-02']
    const loggedByDay = new Map([['2026-07-01', 2]])
    expect(computeAdherenceRatio(days, 2, loggedByDay)).toBe(0.5)
  })

  it('returns null when there are no required meal types configured', () => {
    expect(computeAdherenceRatio(['2026-07-01'], 0, new Map())).toBeNull()
  })

  it('returns null for an empty day window', () => {
    expect(computeAdherenceRatio([], 3, new Map())).toBeNull()
  })
})
