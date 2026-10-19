// #3093 review. The route map's scrub marker and HR-zone colours turn the saved pace series back into
// distance (`scrub.ts`). A bucket spanning a pause is slower than the save schema allows, so
// `summariseRoute` caps it; dropping it instead counted the pause at running pace and put everything
// after it hundreds of metres ahead.
import { describe, expect, it } from 'vitest'
import { summariseRoute } from '@trainingai/shared/activity/route-summary'
import { computeTotalDistanceKm } from '@trainingai/shared/activity/route-metrics'
import type { RoutePoint } from '@trainingai/shared/activity/route-encoding'
import { estimateDistanceKmAtTime, estimateTimeAtDistanceKm } from '../scrub'

// Local midday, clear of any date boundary.
const t0 = Date.parse('2026-10-12T12:00:00+10:00')
// 10 km/h: 5.6 m every 2 s for `before` fixes, a pause of `pauseSec`, then 300 more fixes.
function pausedRun(before: number, pauseSec: number): RoutePoint[] {
  const points: RoutePoint[] = []
  for (let i = 0; i < before + 300; i++) {
    const sec = i * 2 + (i >= before ? pauseSec : 0)
    points.push({ lat: -27.47 + (i * 5.6) / 111_195, lng: 153.02, t: t0 + sec * 1000 })
  }
  return points
}
const trueKmAt = (points: RoutePoint[], tSec: number) =>
  computeTotalDistanceKm(points.filter(p => (p.t - points[0].t) / 1000 <= tSec))

describe('scrub position after a pause (#3093)', () => {
  for (const pauseSec of [60, 120, 300]) {
    it(`stays near the true distance after a ${pauseSec / 60}-minute pause`, () => {
      let worstKm = 0
      let worstSec = 0
      // Every alignment of the pause against the 30 s pace buckets.
      for (let before = 90; before < 105; before++) {
        const points = pausedRun(before, pauseSec)
        const { paceSeries } = summariseRoute(points)!
        const endSec = (points.at(-1)!.t - points[0].t) / 1000
        for (let t = before * 2 + pauseSec + 30; t <= endSec; t += 30) {
          const truth = trueKmAt(points, t)
          worstKm = Math.max(worstKm, Math.abs(estimateDistanceKmAtTime(paceSeries, t) - truth))
          worstSec = Math.max(worstSec, Math.abs(estimateTimeAtDistanceKm(paceSeries, truth) - t))
        }
      }
      // Clamped, the bucket spanning the pause counts at an hour per km: measured worst 12, 29 and
      // 79 m for 1, 2 and 5 minutes. With the bucket dropped, the same tracks drifted 167–833 m.
      expect(worstKm).toBeLessThan(0.1)
      expect(worstSec).toBeLessThan(40)
    })
  }
})
