import { describe, expect, it } from 'vitest'
import { decodeRoute, encodeRoute, type RoutePoint } from '../activity/route-encoding'
import { computeTotalDistanceKm } from '../activity/route-metrics'
import { summariseRoute } from '../activity/route-summary'

// Local midday, well clear of any date boundary.
const t0 = Date.parse('2026-10-12T12:00:00+10:00')
const north = (metres: number, sec: number, ele?: number): RoutePoint => ({
  lat: -27.47 + metres / 111_195, lng: 153.02, t: t0 + sec * 1000, ...(ele != null ? { ele } : {}),
})

describe('route encoding (#2845)', () => {
  it("matches Google's documented polyline example", () => {
    const points = [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }]
    expect(encodeRoute(points)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
    expect(decodeRoute('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual(points)
  })
  it('rounds halves away from zero, as @mapbox/polyline does', () => {
    expect(encodeRoute([{ lat: -0.000005, lng: 0.000005 }])).toBe(encodeRoute([{ lat: -0.00001, lng: 0.00001 }]))
    expect(encodeRoute([])).toBe('')
    expect(decodeRoute('')).toEqual([])
  })
})

describe('summariseRoute (#2845)', () => {
  it('is null for fewer than two fixes', () => {
    expect(summariseRoute([])).toBeNull()
    expect(summariseRoute([north(0, 0)])).toBeNull()
  })
  it('paces over the GPS fix span unless given an elapsed time', () => {
    const points = Array.from({ length: 121 }, (_, i) => north(i * 10, i * 2, 10 + (i % 2)))
    const km = computeTotalDistanceKm(points)
    const route = summariseRoute(points)!
    expect(route.distanceKm).toBe(Math.round(km * 100) / 100)
    expect(route.avgPaceSecPerKm).toBe(Math.round(240 / km))
    expect(summariseRoute(points, 300)!.avgPaceSecPerKm).toBe(Math.round(300 / km))
    expect(route.splits).toHaveLength(1)
    expect(route.elevationGainM).toBe(60)
    expect(route.elevationLossM).toBe(60)
    expect(decodeRoute(route.routePolyline)).toHaveLength(2)
  })
})
