import { describe, it, expect } from 'vitest'
import { estimateDistanceKmAtTime, estimateTimeAtDistanceKm, pointAtDistanceKm } from '../scrub'

describe('estimateDistanceKmAtTime', () => {
  it('returns 0 for an empty pace series', () => {
    expect(estimateDistanceKmAtTime([], 60)).toBe(0)
  })

  it('accumulates full buckets before the target time', () => {
    // Bucket 1: 0-30s at 300 sec/km (0.1km). Bucket 2: 30-60s at 300 sec/km (0.1km).
    const series = [{ tSec: 30, paceSec: 300 }, { tSec: 60, paceSec: 300 }]
    expect(estimateDistanceKmAtTime(series, 60)).toBeCloseTo(0.2, 5)
  })

  it('interpolates a fraction of the bucket containing the target time', () => {
    // Bucket 1 covers 0-30s at 300 sec/km. Target at t=15s is halfway through it.
    const series = [{ tSec: 30, paceSec: 300 }]
    expect(estimateDistanceKmAtTime(series, 15)).toBeCloseTo(0.05, 5)
  })

  it('clamps to the total distance when the target time exceeds the series', () => {
    const series = [{ tSec: 30, paceSec: 300 }]
    expect(estimateDistanceKmAtTime(series, 999)).toBeCloseTo(0.1, 5)
  })
})

describe('estimateTimeAtDistanceKm', () => {
  it('is the inverse of estimateDistanceKmAtTime for a simple single-bucket series', () => {
    // 300 sec/km for the whole 30s bucket → 0.1km total. Halfway (0.05km) is 15s in.
    const series = [{ tSec: 30, paceSec: 300 }]
    expect(estimateTimeAtDistanceKm(series, 0.05)).toBeCloseTo(15, 5)
  })

  it('finds the correct bucket across multiple buckets with different paces', () => {
    // Bucket 1: 0-30s at 300 sec/km → 0.1km. Bucket 2: 30-90s at 200 sec/km → 0.3km.
    // Target 0.2km is 0.1km into bucket 2 → 0.1 * 200 = 20s in, so tSec = 30 + 20 = 50.
    const series = [{ tSec: 30, paceSec: 300 }, { tSec: 90, paceSec: 200 }]
    expect(estimateTimeAtDistanceKm(series, 0.2)).toBeCloseTo(50, 5)
  })

  it('clamps to the series end when the target distance exceeds total coverage', () => {
    const series = [{ tSec: 30, paceSec: 300 }]
    expect(estimateTimeAtDistanceKm(series, 999)).toBe(30)
  })

  it('round-trips through estimateDistanceKmAtTime', () => {
    const series = [{ tSec: 20, paceSec: 250 }, { tSec: 50, paceSec: 180 }, { tSec: 100, paceSec: 220 }]
    const totalKm = estimateDistanceKmAtTime(series, 100)
    const midKm = totalKm / 2
    const tSec = estimateTimeAtDistanceKm(series, midKm)
    expect(estimateDistanceKmAtTime(series, tSec)).toBeCloseTo(midKm, 5)
  })
})

describe('pointAtDistanceKm', () => {
  it('returns null for fewer than 2 points', () => {
    expect(pointAtDistanceKm([{ lat: 0, lng: 0 }], 1)).toBeNull()
  })

  it('returns the first point for a non-positive target distance', () => {
    const points = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }]
    expect(pointAtDistanceKm(points, 0)).toEqual({ lat: 0, lng: 0 })
  })

  it('interpolates between the two bracketing points', () => {
    // A straight line along the equator: ~111.19km per degree of longitude.
    const points = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }]
    const result = pointAtDistanceKm(points, 55.6) // ~half the segment
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(0, 5)
    expect(result!.lng).toBeCloseTo(0.5, 1)
  })

  it('returns the last point when the target exceeds the route length', () => {
    const points = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }]
    expect(pointAtDistanceKm(points, 99999)).toEqual({ lat: 0, lng: 1 })
  })
})
