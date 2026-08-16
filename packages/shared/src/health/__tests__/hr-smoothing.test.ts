import { describe, it, expect } from 'vitest'
import { bucketAverage, rollingMedian, isPlausibleHrSample, median } from '../hr-smoothing'

describe('bucketAverage', () => {
  it('groups points into buckets and rounds the mean', () => {
    const points = [
      { x: 0, bpm: 60 }, { x: 1, bpm: 62 }, // bucket 0
      { x: 5, bpm: 70 }, { x: 6, bpm: 71 }, // bucket 5
    ]
    expect(bucketAverage(points, 5)).toEqual([
      { x: 0, y: 61 },
      { x: 5, y: Math.round((70 + 71) / 2) },
    ])
  })

  it('sorts buckets by x ascending regardless of input order', () => {
    const points = [{ x: 10, bpm: 80 }, { x: 0, bpm: 60 }, { x: 5, bpm: 70 }]
    const result = bucketAverage(points, 5)
    expect(result.map(r => r.x)).toEqual([0, 5, 10])
  })

  it('returns an empty array for empty input', () => {
    expect(bucketAverage([], 5)).toEqual([])
  })

  it('handles a single point', () => {
    expect(bucketAverage([{ x: 3, bpm: 55 }], 5)).toEqual([{ x: 0, y: 55 }])
  })
})

describe('rollingMedian', () => {
  it('flattens a single spike', () => {
    const result = rollingMedian([60, 60, 140, 60, 60], 5)
    expect(result[2]).toBe(60)
  })

  it('is identity on a flat series', () => {
    expect(rollingMedian([65, 65, 65, 65, 65], 3)).toEqual([65, 65, 65, 65, 65])
  })

  it('handles empty input', () => {
    expect(rollingMedian([], 5)).toEqual([])
  })

  it('handles short input shorter than the window', () => {
    // Window clamps to the available slice; both points share the same 2-element
    // window here, so the upper-median tie-break yields 80 for both.
    expect(rollingMedian([70, 80], 5)).toEqual([80, 80])
  })
})

describe('median', () => {
  it('returns the middle value', () => {
    expect(median([60, 100, 80])).toBe(80)
  })
  it('returns 0 for empty', () => {
    expect(median([])).toBe(0)
  })
})

describe('isPlausibleHrSample', () => {
  it('rejects physiologically-impossible values', () => {
    expect(isPlausibleHrSample(10, [110, 112, 115])).toBe(false)
    expect(isPlausibleHrSample(260, [110, 112, 115])).toBe(false)
  })

  it('rejects a sporadic low false-positive against a high working trend', () => {
    // The exact 60/38-bpm mid-workout artefacts from the field reports.
    expect(isPlausibleHrSample(60, [112, 115, 118, 116, 114])).toBe(false)
    expect(isPlausibleHrSample(38, [112, 115, 118, 116, 114])).toBe(false)
  })

  it('accepts gradual real recovery (small step-to-step change)', () => {
    expect(isPlausibleHrSample(120, [130, 128, 125, 122])).toBe(true)
  })

  it('accepts anything while the buffer is still warming up (<3 samples)', () => {
    expect(isPlausibleHrSample(150, [90])).toBe(true)
  })
})
