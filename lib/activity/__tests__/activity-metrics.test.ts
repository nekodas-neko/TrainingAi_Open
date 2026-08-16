import { describe, it, expect } from 'vitest'
import {
  haversineDistanceKm,
  computeTotalDistanceKm,
  computeSplits,
  computeBestEfforts,
  computePaceSeries,
  computeElevationChange,
  computeElevationProfile,
  computeAvgPaceSecPerKm,
} from '../activity-metrics'
import type { RoutePoint } from '../route-encoding'

describe('haversineDistanceKm', () => {
  it('returns ~0 for identical points', () => {
    const p = { lat: -27.4698, lng: 153.0251, t: 0 }
    expect(haversineDistanceKm(p, p)).toBeCloseTo(0, 5)
  })

  it('returns ~111km for 1 degree of latitude', () => {
    const a = { lat: 0, lng: 0, t: 0 }
    const b = { lat: 1, lng: 0, t: 0 }
    expect(haversineDistanceKm(a, b)).toBeCloseTo(111.2, 0)
  })
})

/** Builds a synthetic straight-line route running due north at a constant pace. */
function buildLinearRoute(numPoints: number, kmPerPoint: number, secPerPoint: number, elevations?: number[]): RoutePoint[] {
  const points: RoutePoint[] = []
  const degPerKm = 1 / 111.2 // approx degrees latitude per km
  for (let i = 0; i < numPoints; i++) {
    points.push({
      lat: i * kmPerPoint * degPerKm,
      lng: 0,
      ele: elevations?.[i],
      t: i * secPerPoint * 1000,
    })
  }
  return points
}

describe('computeTotalDistanceKm', () => {
  it('sums distance across a route', () => {
    const points = buildLinearRoute(11, 0.1, 30) // 10 segments of 0.1km = 1km
    expect(computeTotalDistanceKm(points)).toBeCloseTo(1, 1)
  })

  it('returns 0 for fewer than 2 points', () => {
    expect(computeTotalDistanceKm([])).toBe(0)
    expect(computeTotalDistanceKm([{ lat: 0, lng: 0, t: 0 }])).toBe(0)
  })
})

describe('computeSplits', () => {
  it('produces one split per completed km at constant pace', () => {
    // 100 points, 0.03km apart, 9s apart => 3km route, 5 min/km pace (300s)
    const points = buildLinearRoute(101, 0.03, 9)
    const splits = computeSplits(points)
    expect(splits.length).toBeGreaterThanOrEqual(2)
    expect(splits[0].km).toBe(1)
    expect(splits[0].paceSec).toBeCloseTo(300, -1) // within ~10s
  })

  it('returns empty for fewer than 2 points', () => {
    expect(computeSplits([])).toEqual([])
  })
})

describe('computeBestEfforts', () => {
  it('finds the fastest 1km segment', () => {
    const points = buildLinearRoute(101, 0.03, 9) // 3km @ 5min/km constant
    const efforts = computeBestEfforts(points)
    expect(efforts['1km']).toBeCloseTo(300, -1)
  })

  it('omits distances longer than the total route', () => {
    const points = buildLinearRoute(11, 0.1, 30) // 1km total
    const efforts = computeBestEfforts(points)
    expect(efforts['5km']).toBeUndefined()
  })
})

describe('computePaceSeries', () => {
  it('buckets pace over time', () => {
    const points = buildLinearRoute(61, 0.03, 1) // 60s, 1.8km @ ~33s/km
    const series = computePaceSeries(points, 30)
    expect(series.length).toBeGreaterThanOrEqual(1)
    expect(series[0].tSec).toBeCloseTo(30, 0)
  })
})

describe('computeElevationChange', () => {
  it('sums gains and losses separately', () => {
    const points = buildLinearRoute(5, 0.1, 30, [100, 105, 102, 110, 108])
    // diffs: +5, -3, +8, -2 => gain 13, loss 5
    expect(computeElevationChange(points)).toEqual({ gainM: 13, lossM: 5 })
  })

  it('ignores points with missing elevation', () => {
    const points = buildLinearRoute(3, 0.1, 30)
    expect(computeElevationChange(points)).toEqual({ gainM: 0, lossM: 0 })
  })
})

describe('computeElevationProfile', () => {
  it('buckets elevation by distance', () => {
    // 5 points, 0.15km apart => spans 0.6km total
    const points = buildLinearRoute(5, 0.15, 30, [10, 15, 25, 20, 15])
    const profile = computeElevationProfile(points, 0.2)
    expect(profile.length).toBeGreaterThan(0)
    expect(profile[0]).toEqual({ distKm: 0, eleM: 10 })
    for (let i = 1; i < profile.length; i++) {
      expect(profile[i].distKm).toBeGreaterThan(profile[i - 1].distKm)
    }
  })

  it('skips points with no elevation data', () => {
    const points = buildLinearRoute(3, 0.1, 30)
    expect(computeElevationProfile(points)).toEqual([])
  })

  it('returns empty for fewer than 2 points', () => {
    expect(computeElevationProfile(buildLinearRoute(1, 0.1, 30, [10]))).toEqual([])
  })
})

describe('computeAvgPaceSecPerKm', () => {
  it('computes pace from distance and duration', () => {
    expect(computeAvgPaceSecPerKm(5, 1500)).toBe(300)
  })

  it('returns null for zero distance', () => {
    expect(computeAvgPaceSecPerKm(0, 1500)).toBeNull()
  })
})
