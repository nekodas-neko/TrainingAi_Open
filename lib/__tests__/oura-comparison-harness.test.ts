import { describe, it, expect } from 'vitest'
import { mergeComparisonPoints } from '@/lib/oura-comparison-harness'

describe('mergeComparisonPoints', () => {
  it('scores a point within tolerance', () => {
    const result = mergeComparisonPoints('heart_rate', 'bpm', 5,
      [{ bucketStart: '2026-07-27T00:00:00.000Z', value: 100 }],
      [{ bucketStart: '2026-07-27T00:00:00.000Z', value: 102 }],
    )
    expect(result.points).toEqual([
      { bucketStart: '2026-07-27T00:00:00.000Z', ours: 100, reference: 102 },
    ])
    expect(result.summary).toEqual({ withinCount: 1, outOfBandCount: 0, meanAbsDelta: 2 })
  })

  it('scores a point out of tolerance', () => {
    const result = mergeComparisonPoints('heart_rate', 'bpm', 5,
      [{ bucketStart: '2026-07-27T00:00:00.000Z', value: 100 }],
      [{ bucketStart: '2026-07-27T00:00:00.000Z', value: 120 }],
    )
    expect(result.summary).toEqual({ withinCount: 0, outOfBandCount: 1, meanAbsDelta: 20 })
  })

  it('keeps a bucket with only one side present, excluded from scoring', () => {
    const result = mergeComparisonPoints('heart_rate', 'bpm', 5,
      [{ bucketStart: '2026-07-27T00:00:00.000Z', value: 100 }],
      [{ bucketStart: '2026-07-27T00:01:00.000Z', value: 102 }],
    )
    expect(result.points).toEqual([
      { bucketStart: '2026-07-27T00:00:00.000Z', ours: 100, reference: null },
      { bucketStart: '2026-07-27T00:01:00.000Z', ours: null, reference: 102 },
    ])
    expect(result.summary).toEqual({ withinCount: 0, outOfBandCount: 0, meanAbsDelta: null })
  })

  it('sorts merged points by bucketStart', () => {
    const result = mergeComparisonPoints('heart_rate', 'bpm', 5,
      [{ bucketStart: '2026-07-27T00:02:00.000Z', value: 100 }],
      [{ bucketStart: '2026-07-27T00:00:00.000Z', value: 90 }],
    )
    expect(result.points.map(p => p.bucketStart)).toEqual([
      '2026-07-27T00:00:00.000Z',
      '2026-07-27T00:02:00.000Z',
    ])
  })

  it('returns empty summary for no points', () => {
    const result = mergeComparisonPoints('heart_rate', 'bpm', 5, [], [])
    expect(result.points).toEqual([])
    expect(result.summary).toEqual({ withinCount: 0, outOfBandCount: 0, meanAbsDelta: null })
  })
})
