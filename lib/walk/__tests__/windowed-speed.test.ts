import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { windowedSpeedKmh, SPEED_WINDOW_SEC, STOPPED_KMH, readPacer, bandFor } from '../walk-pacer'
import { computeAvgPaceSecPerKm } from '@/lib/activity/activity-metrics'
import type { RoutePoint } from '@/lib/activity/route-encoding'

/**
 * LA-52 — the speed rung read the average speed of the whole walk, so it could not track effort.
 *
 * **The reason this defect survived a passing e2e is worth stating, because it decides the shape of
 * these tests.** `e2e/walk-pacer-speed-rung.spec.ts` asserts the readout appears, the fallback note
 * names the rung, and a thin history drops the rung — none of which needs the band to *respond*, and
 * it drives a short series where a cumulative mean is still responsive. **A test that never changes
 * effort mid-walk cannot see this.** So every case below walks at one speed and then changes it.
 */

/** A straight north-bound track at a fixed speed, one fix per second. */
function leg(from: RoutePoint, kmh: number, seconds: number): RoutePoint[] {
  const KM_PER_DEG_LAT = 111.32
  const out: RoutePoint[] = []
  let { lat, t } = from
  for (let i = 0; i < seconds; i++) {
    lat += (kmh / 3600) / KM_PER_DEG_LAT
    t += 1000
    out.push({ lat, lng: from.lng, t })
  }
  return out
}

const ORIGIN: RoutePoint = { lat: -27.47, lng: 153.03, t: 1_700_000_000_000 }

describe('windowedSpeedKmh reads now, not the whole walk', () => {
  it('matches the steady speed it was built from', () => {
    const pts = [ORIGIN, ...leg(ORIGIN, 5, 120)]
    expect(windowedSpeedKmh(pts)).toBeCloseTo(5, 1)
  })

  it('tracks a mid-walk slow-down that a cumulative average cannot', () => {
    // Twenty minutes at 5 km/h, then thirty seconds at 2. This is the case the entry describes.
    const fast = leg(ORIGIN, 5, 1200)
    const slow = leg(fast[fast.length - 1], 2, 30)
    const pts = [ORIGIN, ...fast, ...slow]

    expect(windowedSpeedKmh(pts)).toBeCloseTo(2, 0)

    // What the old wiring fed the rung, computed the same way the store computes it. It has barely
    // moved off 5 — which is the whole finding, so it is asserted rather than described.
    const distanceKm = 1200 * (5 / 3600) + 30 * (2 / 3600)
    const elapsedSec = (pts[pts.length - 1].t - ORIGIN.t) / 1000
    const cumulativeKmh = 3600 / computeAvgPaceSecPerKm(distanceKm, elapsedSec)!
    expect(cumulativeKmh).toBeGreaterThan(4.9)
  })

  it('lets STOPPED_KMH fire, which it could not before', () => {
    // Standing still: fixes keep arriving at the same place. Twenty minutes of walking first, so a
    // cumulative average is pinned high — exactly when the old reading could never reach the floor.
    const walked = leg(ORIGIN, 5, 1200)
    const last = walked[walked.length - 1]
    const still = Array.from({ length: 30 }, (_, i) => ({ ...last, t: last.t + (i + 1) * 1000 }))
    const pts = [ORIGIN, ...walked, ...still]

    expect(windowedSpeedKmh(pts)!).toBeLessThan(STOPPED_KMH)

    const distanceKm = 1200 * (5 / 3600)
    const elapsedSec = (pts[pts.length - 1].t - ORIGIN.t) / 1000
    expect(3600 / computeAvgPaceSecPerKm(distanceKm, elapsedSec)!).toBeGreaterThan(STOPPED_KMH)
  })

  it('reads the stopped band through readPacer, not just the number', () => {
    const walked = leg(ORIGIN, 5, 600)
    const last = walked[walked.length - 1]
    const still = Array.from({ length: 30 }, (_, i) => ({ ...last, t: last.t + (i + 1) * 1000 }))
    const reading = readPacer({
      kind: 'fast',
      cadenceSpm: null,
      speedKmh: windowedSpeedKmh([ORIGIN, ...walked, ...still]),
      bpm: null,
      cadenceTargets: { fast: 120, slow: 95 },
      speedTargets: { fast: 6, slow: 4 },
      hrTargets: { fast: 140, slow: 110 },
    })!
    expect(reading.signal).toBe('speed')
    expect(reading.band).toBe('stopped')
  })

  it('separates a fast block from a slow one — the distinction the plan is built on', () => {
    const warm = leg(ORIGIN, 4, 300)
    const fast = leg(warm[warm.length - 1], 7, 60)
    const targets = { fast: 6, slow: 4 }
    expect(bandFor(windowedSpeedKmh([ORIGIN, ...warm])!, 'fast', targets)).toBe('red')
    expect(bandFor(windowedSpeedKmh([ORIGIN, ...warm, ...fast])!, 'fast', targets)).toBe('green')
  })

  it('ignores everything older than the window', () => {
    const old = leg(ORIGIN, 12, 600)
    const recent = leg(old[old.length - 1], 3, SPEED_WINDOW_SEC)
    expect(windowedSpeedKmh([ORIGIN, ...old, ...recent])).toBeCloseTo(3, 0)
  })

  it('is null rather than zero when there is nothing to measure', () => {
    // Null drops the pacer to the heart-rate rung. Zero would announce "Stopped" to someone who has
    // simply not got a second fix yet.
    expect(windowedSpeedKmh([])).toBeNull()
    expect(windowedSpeedKmh([ORIGIN])).toBeNull()
    expect(windowedSpeedKmh([ORIGIN, { ...ORIGIN }])).toBeNull()
  })

  it('reaches back past the window when fixes are sparse, rather than going null', () => {
    // One fix per minute: nothing but the last point falls inside a 20 s window.
    const sparse = [ORIGIN, { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng, t: ORIGIN.t + 60_000 }]
    expect(windowedSpeedKmh(sparse)).toBeCloseTo(6.68, 1)
  })
})

/**
 * The helper being right is half of it. The defect LA-52 describes was entirely in the *wiring* —
 * `walk-active.tsx` passing `kmhFromPace(currentPaceSecPerKm)` into `readPacer` — so a perfect
 * windowed function reachable from nowhere would leave the bug exactly where it was.
 */
const ROOT = path.resolve(__dirname, '../../..')
const source = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('the screen and the store are wired to the windowed reading', () => {
  it('walk-active pacer input is recentSpeedKmh, and the cumulative pace reaches no speed', () => {
    const src = source('components/guided-walk/walk-active.tsx')
    expect(src).toMatch(/const speedKmh = recentSpeedKmh/)
    expect(src).not.toMatch(/kmhFromPace/)
  })

  it('the store recomputes it on every appended point', () => {
    expect(source('lib/stores/guided-walk-store.ts')).toMatch(/recentSpeedKmh: windowedSpeedKmh\(/)
  })

  it('the cumulative figure on screen is labelled as an average', () => {
    // Two readings side by side, one live and one cumulative. Without the word the second is read
    // as the first, which is how the cumulative one came to be trusted as "now".
    expect(source('components/guided-walk/walk-active.tsx')).toMatch(/avg \{Math\.floor\(currentPaceSecPerKm/)
  })
})
