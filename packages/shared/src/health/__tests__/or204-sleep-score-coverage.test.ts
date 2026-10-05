// OR-204 — a Sleep Score says how complete its inputs were, in three bands, by model weight.
import { describe, it, expect } from 'vitest'
import { sleepScoreCoverage, SLEEP_WEIGHTS, SLEEP_COVERAGE_LOW_MISSING_WEIGHT } from '../sleep-score'

const all = Object.fromEntries(Object.keys(SLEEP_WEIGHTS).map(k => [k, 80])) as Record<string, number>
const without = (...keys: string[]) => Object.fromEntries(Object.entries(all).filter(([k]) => !keys.includes(k)))

describe('sleepScoreCoverage', () => {
  it('is full when every contributor is present', () => {
    expect(sleepScoreCoverage(all)).toEqual({ ratio: 1, missing: [], level: 'full' })
  })
  it('is partial for a small gap: latency alone is 6 of 110', () => {
    expect(sleepScoreCoverage(without('latency'))).toMatchObject({ level: 'partial', missing: ['latency'], ratio: 0.95 })
  })
  it('stays partial below the hr+hrv share: REM and deep together are 20 of 110', () => {
    expect(sleepScoreCoverage(without('rem', 'deep')).level).toBe('partial')
  })
  it('is low once the missing weight reaches hr+hrv (28 of 110)', () => {
    expect(SLEEP_COVERAGE_LOW_MISSING_WEIGHT).toBe(28)
    expect(sleepScoreCoverage(without('hr', 'hrv'))).toMatchObject({ level: 'low', ratio: 0.75 })
  })
})
