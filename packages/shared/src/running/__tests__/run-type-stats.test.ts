import { describe, it, expect } from 'vitest'
import { computeRunTypeStats, type CompletedRunForStats } from '../run-type-stats'

const run = (overrides: Partial<CompletedRunForStats>): CompletedRunForStats => ({
  runType: 'tempo', distanceKm: null, avgPaceSecPerKm: null, avgHr: null,
  ...overrides,
})

describe('computeRunTypeStats', () => {
  it('averages pace/distance/HR across all runs of one type', () => {
    const runs: CompletedRunForStats[] = [
      run({ runType: 'tempo', distanceKm: 5, avgPaceSecPerKm: 300, avgHr: 150 }),
      run({ runType: 'tempo', distanceKm: 6, avgPaceSecPerKm: 320, avgHr: 160 }),
      run({ runType: 'easy', distanceKm: 3, avgPaceSecPerKm: 400, avgHr: 120 }),
    ]
    const result = computeRunTypeStats(runs)
    expect(result.tempo).toEqual({ avgPaceSecPerKm: 310, avgDistanceKm: 5.5, avgHr: 155, count: 2 })
    expect(result.easy).toEqual({ avgPaceSecPerKm: 400, avgDistanceKm: 3, avgHr: 120, count: 1 })
  })

  it('skips null-stat runs in the average instead of treating them as zero', () => {
    const runs: CompletedRunForStats[] = [
      run({ runType: 'long', distanceKm: null, avgPaceSecPerKm: 350, avgHr: null }),
      run({ runType: 'long', distanceKm: 10, avgPaceSecPerKm: null, avgHr: 140 }),
    ]
    const result = computeRunTypeStats(runs)
    expect(result.long.avgPaceSecPerKm).toBe(350)
    expect(result.long.avgDistanceKm).toBe(10)
    expect(result.long.avgHr).toBe(140)
    expect(result.long.count).toBe(2)
  })

  it('drops runs whose type is not one of the five known RunTypes', () => {
    const runs: CompletedRunForStats[] = [run({ runType: 'legacy-unknown-type', distanceKm: 5 })]
    const result = computeRunTypeStats(runs)
    expect(Object.values(result).every((agg) => agg.count === 0)).toBe(true)
  })

  it('returns null/0 for a type with no runs at all', () => {
    const result = computeRunTypeStats([])
    expect(result.recovery).toEqual({ avgPaceSecPerKm: null, avgDistanceKm: null, avgHr: null, count: 0 })
  })
})
