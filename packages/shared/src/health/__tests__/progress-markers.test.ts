import { describe, it, expect } from 'vitest'
import { assessMarker, assessFromTrends, MARKER_CONFIGS } from '../progress-markers'

describe('assessMarker — direction-aware progress', () => {
  it('resting HR falling reads as improving (lower is better)', () => {
    const a = assessMarker(MARKER_CONFIGS.resting_hr, [60, 60, 59, 58, 57, 55, 54])
    expect(a.trend).toBe('improving')
    expect(a.baseline).toBeGreaterThan(a.current!)
  })

  it('resting HR rising reads as declining', () => {
    const a = assessMarker(MARKER_CONFIGS.resting_hr, [54, 55, 56, 58, 60, 62])
    expect(a.trend).toBe('declining')
  })

  it('HRR1 rising reads as improving (higher is better) and bands it', () => {
    const a = assessMarker(MARKER_CONFIGS.hrr1, [15, 16, 18, 20, 24, 26])
    expect(a.trend).toBe('improving')
    expect(a.band).toBe('strong')   // current ~25 → 22–29 band
  })

  it('a change under the noise floor reads as stable', () => {
    const a = assessMarker(MARKER_CONFIGS.resting_hr, [58, 59, 58, 57, 58, 59])
    expect(a.trend).toBe('stable')
  })

  it('flags insufficient data below 4 points', () => {
    expect(assessMarker(MARKER_CONFIGS.hrr1, [20, 21]).trend).toBe('insufficient')
    expect(assessMarker(MARKER_CONFIGS.hrr1, [null, undefined, 20]).trend).toBe('insufficient')
  })

  it('HRR1 below 13 bands as below normal', () => {
    const a = assessMarker(MARKER_CONFIGS.hrr1, [10, 10, 11, 11, 12, 11])
    expect(a.band).toBe('below normal')
  })

  it('assessFromTrends returns RHR + HRR1 + HRV', () => {
    const trends = Array.from({ length: 9 }, (_, i) => ({
      rhrBpm: 60 - i, hrr1Bpm: 14 + i, hrvMs: 40 + i * 2,
    }))
    const out = assessFromTrends(trends)
    expect(out.map((m) => m.key)).toEqual(['resting_hr', 'hrr1', 'hrv'])
    expect(out[0].trend).toBe('improving') // RHR falling
    expect(out[1].trend).toBe('improving') // HRR1 rising
    expect(out[2].trend).toBe('improving') // HRV rising
  })
})
