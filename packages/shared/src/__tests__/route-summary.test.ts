import { describe, expect, it } from 'vitest'
import { decodeRoute, encodeRoute, type RoutePoint } from '../activity/route-encoding'
import { computeTotalDistanceKm } from '../activity/route-metrics'
import { summariseRoute } from '../activity/route-summary'
import { ActivityLogBody } from '../validation/activity-log'
import { MAX_PACE_SEC_PER_KM } from '../validation/plausibility'

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
    expect(summariseRoute([], 0)).toBeNull()
    expect(summariseRoute([north(0, 0)], 0)).toBeNull()
  })
  it('paces over the active seconds it is given, not the GPS fix span (#3092)', () => {
    const points = Array.from({ length: 121 }, (_, i) => north(i * 10, i * 2, 10 + (i % 2)))
    const km = computeTotalDistanceKm(points)
    const route = summariseRoute(points, 240)!
    expect(route.distanceKm).toBe(Math.round(km * 100) / 100)
    expect(route.avgPaceSecPerKm).toBe(Math.round(240 / km))
    // A 2-minute pause in the middle: the fixes span 360 s, the run was 240 s of it.
    const paused = [...points.slice(0, 61), ...points.slice(61).map(p => ({ ...p, t: p.t + 120_000 }))]
    expect(summariseRoute(paused, 240)!.avgPaceSecPerKm).toBe(Math.round(240 / km))
    expect(route.splits).toHaveLength(1)
    expect(route.elevationGainM).toBe(60)
    expect(route.elevationLossM).toBe(60)
    expect(decodeRoute(route.routePolyline)).toHaveLength(2)
  })
})

// #3093 review. Tracks real activities produce: a pause, a stop, and a long loss of signal. A pace
// bucket or split across any of them covers a few metres in minutes, which the save schema rejects.
describe('summariseRoute output always fits the save schema (#3093)', () => {
  // `steps` fixes 2 s apart, `metres` each, starting at `fromM` metres and `fromSec` seconds.
  const leg = (fromM: number, fromSec: number, steps: number, metres: number) =>
    Array.from({ length: steps }, (_, i) => north(fromM + (i + 1) * metres, fromSec + (i + 1) * 2))
  const save = (points: RoutePoint[], paceElapsedSec: number) => {
    const route = summariseRoute(points, paceElapsedSec)!
    return ActivityLogBody.safeParse({
      date: '2026-10-12', activityType: 'run', title: 'Run', durationMin: 20, ...route,
    })
  }
  const cases: [string, RoutePoint[], number][] = []
  // A run with a 2-minute pause at every alignment against the 30 s pace buckets.
  for (let before = 85; before <= 100; before++) {
    const first = leg(0, 0, before, 5.6)
    cases.push([`pause after ${before} fixes`, [...first, ...leg(before * 5.6, before * 2 + 120, 90, 5.6)], (before + 90) * 2])
  }
  // A walk standing 90 s at a crossing, and one that crosses a km boundary during the stop.
  cases.push(['stop at a crossing', [...leg(0, 0, 40, 2.8), ...leg(112, 170, 40, 2.8)], 250])
  cases.push(['stop on a split', [...leg(0, 0, 500, 2), ...leg(1000, 1090, 100, 2)], 1290])
  // Signal lost for 10 minutes, the walk's own time as the pace denominator.
  cases.push(['GPS lost', leg(0, 0, 10, 6), 240])
  for (const [name, points, paceElapsedSec] of cases) {
    it(name, () => {
      const result = save(points, paceElapsedSec)
      expect(result.success, name).toBe(true)
      const route = summariseRoute(points, paceElapsedSec)!
      for (const p of [...route.splits, ...route.paceSeries]) expect(p.paceSec).toBeLessThanOrEqual(MAX_PACE_SEC_PER_KM)
    })
  }
  it('keeps the average out rather than saving a standstill as a pace', () => {
    expect(summariseRoute(leg(0, 0, 10, 6), 240)!.avgPaceSecPerKm).toBeUndefined()
    expect(summariseRoute(leg(0, 0, 10, 6), 18)!.avgPaceSecPerKm).toBe(Math.round(18 / 0.054))
  })
})
