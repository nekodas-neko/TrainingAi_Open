// @vitest-environment jsdom
/**
 * #3684: a timed distance test (Cooper) whose end passes with the screen off. The timer that
 * finishes the test does not run, the GPS watcher keeps recording, and the distance covered after
 * the end used to land in the saved distance and the VO2max read from it. The test now ends at its
 * own end and measures only the fixes up to it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { RoutePoint } from '@/lib/activity/route-encoding'

const h = vi.hoisted(() => ({ onPoint: null as null | ((p: RoutePoint) => void) }))

vi.mock('@/lib/live-hr/manager', () => ({
  getLiveHrManager: () => ({ start: async () => {}, stop: async () => {}, subscribe: () => () => {} }),
}))
vi.mock('@/lib/activity/gps-tracking', () => ({
  startGpsWatcher: vi.fn(async (onPoint: (p: RoutePoint) => void) => {
    h.onPoint = onPoint
    return { stop: async () => {} }
  }),
}))
vi.mock('@/lib/haptics', () => ({ hapticSuccess: vi.fn() }))
vi.mock('../test-timer', () => ({ TestTimer: () => null }))
vi.mock('../test-hr-display', () => ({ TestHrDisplay: () => null }))
vi.mock('../test-hrr-guide', () => ({ TestHrrGuide: () => null }))

import { TestActive, type TestCapture } from '../test-active'
import { getProtocol } from '@trainingai/shared/fitness-tests/protocols'
import { computeTotalDistanceKm } from '@trainingai/shared/activity/route-metrics'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Local midday Brisbane, far from any date edge.
const STARTED = new Date('2026-09-24T02:00:00Z').getTime()
const north = (metres: number) => -27.47 + metres / 111_195

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null
  container.remove()
  vi.restoreAllMocks()
})

async function run(finishAtSec: number) {
  const protocol = getProtocol('cooper12')!
  const captures: TestCapture[] = []
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(TestActive, {
      protocol, profile: { age: 40, restingHr: 60, hrMax: 180 }, startedAtMs: STARTED,
      onFinish: (c: TestCapture) => { captures.push(c) },
    }))
  })
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  // 15 m every 5 s (3 m/s) for 12 minutes and then 10 more minutes before the unlock.
  const points: RoutePoint[] = []
  await act(async () => {
    for (let sec = 0; sec <= 720 + 600; sec += 5) {
      const p = { lat: north(sec * 3), lng: 153.02, t: STARTED + sec * 1000 }
      points.push(p)
      h.onPoint!(p)
    }
  })
  vi.spyOn(Date, 'now').mockReturnValue(STARTED + finishAtSec * 1000)
  const button = [...container.querySelectorAll('button')].find(b => /End test early|Finish/.test(b.textContent ?? ''))!
  await act(async () => { button.click() })
  return { capture: captures[0], points, protocol }
}

describe('a timed test measures only the fixes up to its own end (#3684)', () => {
  it('finished at unlock, ten minutes late: distance and end stop at 12 minutes', async () => {
    const { capture, points } = await run(720 + 600)
    const end = STARTED + 720 * 1000
    expect(capture.endMs).toBe(end)
    const within = points.filter(p => p.t <= end)
    expect(capture.distanceM).toBe(Math.round(computeTotalDistanceKm(within) * 1000))
    expect(capture.distanceM).toBeGreaterThan(2100)
    expect(capture.distanceM).toBeLessThan(2200)
  })

  it('ended early by hand: ends at the tap and measures up to it', async () => {
    const { capture, points } = await run(300)
    const end = STARTED + 300 * 1000
    expect(capture.endMs).toBe(end)
    expect(capture.distanceM).toBe(Math.round(computeTotalDistanceKm(points.filter(p => p.t <= end)) * 1000))
  })
})
