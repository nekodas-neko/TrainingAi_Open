import { describe, it, expect } from 'vitest'
import { computeHrv5MinSeries, type Ibi5MinEvent } from '../hrv-5min'

// One event of `n` beats at a fixed IBI, all quality q, starting at startMs.
function beats(startMs: number, n: number, ibiMs: number, q: number): Ibi5MinEvent {
  return { startMs, ibiMs: Array(n).fill(ibiMs), quality: Array(n).fill(q) }
}

describe('computeHrv5MinSeries', () => {
  it('all-valid single window → median HR = 60bpm, quality = 100', () => {
    // 25 beats at 1000ms IBI = 60bpm, all in one 5-min bucket (25s span).
    const { hrvMedianHR5min, hrvQuality5min } = computeHrv5MinSeries([beats(0, 25, 1000, 1)])
    expect(hrvMedianHR5min).toHaveLength(1)
    expect(hrvMedianHR5min[0]).toBeCloseTo(60, 6)
    expect(hrvQuality5min[0]).toBeCloseTo(100, 6)
  })

  it('drops a window with fewer than 20 surviving beats', () => {
    expect(computeHrv5MinSeries([beats(0, 15, 1000, 1)])).toEqual({
      hrvMedianHR5min: [],
      hrvQuality5min: [],
    })
  })

  it('no events → empty series', () => {
    expect(computeHrv5MinSeries([])).toEqual({ hrvMedianHR5min: [], hrvQuality5min: [] })
  })

  it('a >5min gap between events produces two separate windows', () => {
    // Second event starts well past the first bucket → bucket index 1.
    const out = computeHrv5MinSeries([beats(1000, 25, 1000, 1), beats(400_000, 25, 800, 1)])
    expect(out.hrvMedianHR5min).toHaveLength(2)
    expect(out.hrvMedianHR5min[0]).toBeCloseTo(60, 6) // 1000ms IBI
    expect(out.hrvMedianHR5min[1]).toBeCloseTo(75, 6) // 800ms IBI
    expect(out.hrvQuality5min).toEqual([100, 100])
  })

  it('invalid beats lower quality below 100 (3-tap erosion) while keeping ≥20 valid', () => {
    // 40 beats, the first 4 invalid (q=0); the 3-tap erosion drops a couple more at the boundary.
    const ev: Ibi5MinEvent = {
      startMs: 0,
      ibiMs: Array(40).fill(1000),
      quality: [0, 0, 0, 0, ...Array(36).fill(1)],
    }
    const { hrvMedianHR5min, hrvQuality5min } = computeHrv5MinSeries([ev])
    expect(hrvMedianHR5min).toHaveLength(1)
    expect(hrvMedianHR5min[0]).toBeCloseTo(60, 6)
    expect(hrvQuality5min[0]).toBeGreaterThan(0)
    expect(hrvQuality5min[0]).toBeLessThan(100)
  })

  it('rejects out-of-range IBIs as invalid beats', () => {
    // 30 beats but IBIs of 100ms (600bpm) are physiologically implausible → all invalid → dropped.
    expect(computeHrv5MinSeries([beats(0, 30, 100, 1)])).toEqual({
      hrvMedianHR5min: [],
      hrvQuality5min: [],
    })
  })
})
