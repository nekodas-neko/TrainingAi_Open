import { describe, it, expect } from 'vitest'
import { median, quantile } from '@trainingai/shared/stats'

describe('median', () => {
  it('averages the two middle values on an even count', () => {
    expect(median([2000, 2100, 2200, 2600])).toBe(2150)
  })

  it('takes the middle value on an odd count', () => {
    expect(median([2100, 2000, 2600])).toBe(2100)
  })

  it('does not require sorted input and does not mutate it', () => {
    const input = [5, 1, 4, 2, 3]
    expect(median(input)).toBe(3)
    expect(input).toEqual([5, 1, 4, 2, 3])
  })

  // The defect LA-148 consolidated away: `health/hr-smoothing.ts` returned the UPPER of the two
  // middles, which biases every even-count window upward — on the live-HR path that is a beat the
  // ring never measured being shown as the reading.
  it('is the midpoint on an even count, not the upper middle', () => {
    expect(median([80, 82])).toBe(81)
    expect(median([66, 68])).toBe(67)
  })

  // The other half of that defect. A 0 bpm is a plausible-looking value, so an empty list
  // answering 0 turns "no measurement" into "a measurement of zero".
  it('returns null for empty rather than 0', () => {
    expect(median([])).toBe(null)
  })

  it('handles a single value', () => {
    expect(median([42])).toBe(42)
  })
})

describe('quantile', () => {
  it('interpolates linearly between neighbours', () => {
    // n=4 → idx = 3*0.25 = 0.75, between 10 and 20 → 17.5
    expect(quantile([10, 20, 30, 40], 0.25)).toBe(17.5)
  })

  it('agrees with median at q=0.5', () => {
    for (const xs of [[1, 2, 3], [1, 2, 3, 4], [5], [9, 1, 7, 3, 8]]) {
      expect(quantile(xs, 0.5)).toBe(median(xs))
    }
  })

  it('returns the bounds at q=0 and q=1', () => {
    expect(quantile([30, 10, 20], 0)).toBe(10)
    expect(quantile([30, 10, 20], 1)).toBe(30)
  })

  it('returns null for empty', () => {
    expect(quantile([], 0.5)).toBe(null)
  })
})
