import { describe, it, expect } from 'vitest'
import { resampleTachogram } from '../tachogram'

describe('resampleTachogram', () => {
  it('returns null on empty / all-out-of-band input', () => {
    expect(resampleTachogram([], 2)).toBeNull()
    expect(resampleTachogram([100, 50, 2500], 2)).toBeNull() // all outside [300,2000]
  })

  it('builds an even grid at the requested rate spanning the beat stream', () => {
    // Four 1000 ms beats → span 4000 ms → at 2 Hz, floor(4000/500)+1 = 9 samples.
    const t = resampleTachogram([1000, 1000, 1000, 1000], 2)
    expect(t).not.toBeNull()
    expect(t!.dtMs).toBe(500)
    expect(t!.beatCount).toBe(4)
    expect(t!.spanMs).toBe(4000)
    expect(t!.grid.length).toBe(9)
    // A constant IBI stream resamples to a constant grid.
    expect(t!.grid.every((v) => Math.abs(v - 1000) < 1e-9)).toBe(true)
  })

  it('linearly interpolates between beats', () => {
    // Beats at t=0 (600) and t=600 (1000): the grid sample at t=300 ms is halfway → 800.
    const t = resampleTachogram([600, 1000], 2)
    expect(t).not.toBeNull()
    // grid[0] = 600 (at t=0). grid[1] at t=500 is between beat0(t=0,600) and beat1(t=600,1000):
    // frac = 500/600 → 600 + 400*(500/600) ≈ 933.33.
    expect(t!.grid[0]).toBeCloseTo(600, 6)
    expect(t!.grid[1]).toBeCloseTo(600 + 400 * (500 / 600), 6)
  })

  it('filters out non-physiological IBIs before resampling', () => {
    const t = resampleTachogram([1000, 50, 1000, 5000, 1000], 2)
    expect(t!.beatCount).toBe(3) // the 50 and 5000 are dropped
  })
})
