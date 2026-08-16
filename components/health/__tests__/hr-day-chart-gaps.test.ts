import { describe, it, expect } from 'vitest'
import { withGapBreaks, interpolateGaps } from '../hr-day-chart-gaps'

describe('withGapBreaks', () => {
  it('inserts a NaN-y break marker when the gap between buckets exceeds gapMin', () => {
    // Must be a real {x,y} object (with NaN y), never a bare null — chart.js parses
    // this as object data and does `item.x` on every element, so a null crashes it.
    const points = [{ x: 0, y: 50 }, { x: 5, y: 52 }, { x: 60, y: 55 }]
    const result = withGapBreaks(points, 20)
    expect(result).toHaveLength(4)
    expect(result[0]).toEqual({ x: 0, y: 50 })
    expect(result[1]).toEqual({ x: 5, y: 52 })
    expect(result[2].x).toBe(32.5) // midpoint of the 5→60 gap
    expect(Number.isNaN(result[2].y)).toBe(true)
    expect(result[3]).toEqual({ x: 60, y: 55 })
    // No element may be null/undefined — that is the exact crash condition.
    expect(result.every(p => p != null)).toBe(true)
  })

  it('leaves contiguous buckets untouched', () => {
    const points = [{ x: 0, y: 50 }, { x: 5, y: 52 }, { x: 10, y: 51 }]
    expect(withGapBreaks(points, 20)).toEqual(points)
  })

  it('returns an empty array for no points', () => {
    expect(withGapBreaks([], 20)).toEqual([])
  })
})

describe('interpolateGaps', () => {
  it('bridges a gap within maxGapMin with a two-point segment, isolated by a trailing NaN', () => {
    const points = [{ x: 0, y: 50 }, { x: 60, y: 60 }, { x: 65, y: 61 }]
    const result = interpolateGaps(points, 20, 120)
    expect(result).toEqual([
      { x: 0, y: 50 },
      { x: 60, y: 60 },
      { x: 60, y: NaN },
    ])
  })

  it('does not bridge gaps at or below gapMin', () => {
    const points = [{ x: 0, y: 50 }, { x: 10, y: 52 }, { x: 20, y: 51 }]
    expect(interpolateGaps(points, 20, 120)).toEqual([])
  })

  it('does not bridge gaps larger than maxGapMin — an honest break stays a break', () => {
    const points = [{ x: 0, y: 50 }, { x: 300, y: 55 }]
    expect(interpolateGaps(points, 20, 120)).toEqual([])
  })

  it('isolates two bridged gaps separated by a too-large, unbridged gap', () => {
    const points = [{ x: 0, y: 50 }, { x: 60, y: 55 }, { x: 250, y: 52 }, { x: 310, y: 58 }]
    const result = interpolateGaps(points, 20, 120)
    expect(result).toEqual([
      { x: 0, y: 50 },
      { x: 60, y: 55 },
      { x: 60, y: NaN },
      { x: 250, y: 52 },
      { x: 310, y: 58 },
      { x: 310, y: NaN },
    ])
  })

  it('returns an empty array for no points or a single point', () => {
    expect(interpolateGaps([], 20, 120)).toEqual([])
    expect(interpolateGaps([{ x: 0, y: 50 }], 20, 120)).toEqual([])
  })
})
