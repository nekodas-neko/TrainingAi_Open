import { describe, expect, it } from 'vitest'
import { rangePositions, rangeStats, rangeZones } from '../range-stats'

describe('rangeStats', () => {
  it('returns nulls when nothing finite is given', () => {
    expect(rangeStats([])).toEqual({ min: null, avg: null, max: null })
    expect(rangeStats([null, undefined, NaN, Infinity])).toEqual({ min: null, avg: null, max: null })
  })
  it('ignores nulls and non-finite values', () => {
    expect(rangeStats([50, null, 60, undefined, 70, NaN])).toEqual({ min: 50, avg: 60, max: 70 })
  })
  it('handles a single value', () => {
    expect(rangeStats([42])).toEqual({ min: 42, avg: 42, max: 42 })
  })
})

describe('rangeZones', () => {
  it('always sums to 100', () => {
    for (const o of ['low', 'high', 'mid'] as const) {
      expect(rangeZones(o).reduce((s, z) => s + z.widthPct, 0)).toBe(100)
    }
  })
  it('puts green at the healthy end', () => {
    expect(rangeZones('high').at(-1)!.band).toBe('good')
    expect(rangeZones('low')[0].band).toBe('good')
    expect(rangeZones('mid')[2].band).toBe('good')
  })
})

describe('rangePositions', () => {
  it('places a value and the average along the range', () => {
    expect(rangePositions(60, 40, 80, 50)).toEqual({ pos: 50, avgPos: 25 })
  })
  it('stretches the track to include a value outside the recent range', () => {
    expect(rangePositions(100, 40, 80)).toEqual({ pos: 100, avgPos: null })
  })
  it('centres the marker when there is no spread', () => {
    expect(rangePositions(50, 50, 50, 50)).toEqual({ pos: 50, avgPos: null })
  })
  it('returns null without a value or range', () => {
    expect(rangePositions(null, 1, 2)).toBeNull()
    expect(rangePositions(1, null, 2)).toBeNull()
    expect(rangePositions(1, 1, null)).toBeNull()
  })
})
