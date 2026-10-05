// OR-211 (b). Best average pace had no distance floor, so a 30 m GPS false start (a quick pace read
// from a few metres of drift) became the all-time best. The 1k and 5k bests beside it are windowed.
import { describe, it, expect } from 'vitest'
import { computeRunningBests, BEST_PACE_MIN_DISTANCE_KM } from '../cardio-trends'

const run = (distanceKm: number | undefined, avgPaceSecPerKm: number | undefined) => ({ distanceKm, avgPaceSecPerKm })

describe('best average pace has a distance floor', () => {
  it('ignores a sub-floor GPS fragment, however fast it reads', () => {
    const b = computeRunningBests([run(0.03, 95), run(5, 330), run(8, 345)])
    expect(b.bestAvgPaceSecPerKm).toBe(330)
  })

  it('counts a run that exactly meets the floor', () => {
    expect(computeRunningBests([run(BEST_PACE_MIN_DISTANCE_KM, 300), run(5, 330)]).bestAvgPaceSecPerKm).toBe(300)
  })

  it('does not count a run with no distance, which cannot show it cleared the floor', () => {
    expect(computeRunningBests([run(undefined, 200), run(5, 330)]).bestAvgPaceSecPerKm).toBe(330)
  })

  it('is null when nothing qualifies, and leaves the other bests alone', () => {
    const b = computeRunningBests([run(0.03, 95)])
    expect(b.bestAvgPaceSecPerKm).toBeNull()
    expect(b.longestDistanceKm).toBe(0.03)
    expect(b.totalRuns).toBe(1)
  })
})
