// @vitest-environment jsdom
// #2478. The store reports which gate decided each detected session. Telemetry only: every case
// below also pins the outcome the store produced before the reporting existed.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const recordDetectionEvent = vi.fn()
vi.mock('@/lib/activity/detection-events', () => ({
  recordDetectionEvent: (...args: unknown[]) => recordDetectionEvent(...args),
}))

import { useAutoDetectionStore } from '../auto-detection-store'

const ID = '5e4d3c2b-1a09-4f8e-9d7c-6b5a49382716'
const t0 = Date.UTC(2026, 9, 7, 7, 0, 0)
// `count` points `stepMs` apart, moving `stepDeg` of latitude each (~111 m per 0.001°).
const path = (count: number, stepMs: number, stepDeg: number) =>
  Array.from({ length: count }, (_, i) => ({ t: t0 + i * stepMs, lat: -27.47 + i * stepDeg, lng: 153.02 }))

function runSession(points: Array<{ t: number; lat: number; lng: number }>, activityType?: 'walk' | 'run') {
  useAutoDetectionStore.getState().startSession(t0, activityType, ID)
  for (const p of points) useAutoDetectionStore.getState().addPoint(p)
  useAutoDetectionStore.getState().endSession()
}

const lastCall = () => recordDetectionEvent.mock.calls[recordDetectionEvent.mock.calls.length - 1]

beforeEach(() => {
  recordDetectionEvent.mockClear()
  useAutoDetectionStore.setState({
    sessionStartMs: null, sessionPoints: [], pendingSessions: [], pendingActivityType: null, sessionDetectionId: null,
  })
})

describe('endSession reports the deciding gate (#2478)', () => {
  it('a walk that passes every gate is offered, and its card carries the detection id', () => {
    runSession(path(12, 45_000, 0.0009), 'walk') // ~8 min, ~1.1 km
    const pending = useAutoDetectionStore.getState().pendingSessions
    expect(pending).toHaveLength(1)
    expect(pending[0].detectionId).toBe(ID)
    const [id, kind, gate, detail] = lastCall()
    expect([id, kind, gate]).toEqual([ID, 'offered', 'quality_gates'])
    expect(detail).toMatchObject({ sessionStartAt: t0, pointCount: 12, activityType: 'walk' })
    expect(detail.distanceM).toBeGreaterThan(750)
    expect(useAutoDetectionStore.getState().sessionDetectionId).toBeNull()
  })

  it('too few points', () => {
    runSession(path(1, 0, 0))
    expect(useAutoDetectionStore.getState().pendingSessions).toHaveLength(0)
    expect(lastCall().slice(0, 3)).toEqual([ID, 'dismissed', 'too_few_points'])
  })

  it('under the minimum duration', () => {
    runSession(path(6, 30_000, 0.003)) // 2.5 min
    expect(useAutoDetectionStore.getState().pendingSessions).toHaveLength(0)
    expect(lastCall().slice(0, 3)).toEqual([ID, 'dismissed', 'min_duration'])
    expect(lastCall()[3].elapsedSec).toBe(150)
  })

  it('under the minimum distance', () => {
    runSession(path(12, 45_000, 0.0003)) // ~8 min, ~370 m
    expect(useAutoDetectionStore.getState().pendingSessions).toHaveLength(0)
    expect(lastCall().slice(0, 3)).toEqual([ID, 'dismissed', 'min_distance'])
  })

  it('far enough but too slow', () => {
    runSession(path(41, 45_000, 0.00025)) // 30 min, ~1.1 km → ~0.6 m/s
    expect(useAutoDetectionStore.getState().pendingSessions).toHaveLength(0)
    expect(lastCall().slice(0, 3)).toEqual([ID, 'dismissed', 'min_avg_speed'])
  })

  it('above the motorised average', () => {
    runSession(path(12, 45_000, 0.004)) // ~444 m per 45 s ≈ 9.9 m/s
    expect(useAutoDetectionStore.getState().pendingSessions).toHaveLength(0)
    expect(lastCall().slice(0, 3)).toEqual([ID, 'dismissed', 'max_avg_speed'])
  })

  it('a train: slow average, fast 80th percentile', () => {
    // Long station dwells keep the average under 7.5 m/s; the moving segments run at ~20 m/s.
    const pts: Array<{ t: number; lat: number; lng: number }> = []
    let t = t0
    let lat = -27.47
    for (let i = 0; i < 40; i++) {
      pts.push({ t, lat, lng: 153.02 })
      if (i % 5 === 4) { t += 300_000 } else { t += 10_000; lat += 0.0018 }
    }
    runSession(pts)
    expect(useAutoDetectionStore.getState().pendingSessions).toHaveLength(0)
    expect(lastCall().slice(0, 3)).toEqual([ID, 'dismissed', 'motorised_p80'])
  })

  it('reports nothing when no session was in flight', () => {
    useAutoDetectionStore.getState().endSession()
    expect(recordDetectionEvent).not.toHaveBeenCalled()
  })
})

describe('discard and dismissal (#2478)', () => {
  it('discardSession reports the session as owned by another activity', () => {
    useAutoDetectionStore.getState().startSession(t0, undefined, ID)
    useAutoDetectionStore.getState().discardSession()
    expect(lastCall().slice(0, 3)).toEqual([ID, 'dismissed', 'session_owned'])
    expect(useAutoDetectionStore.getState().pendingSessions).toHaveLength(0)
  })

  it('the card Dismiss reports user_card for that session, and still removes it', () => {
    runSession(path(12, 45_000, 0.0009), 'walk')
    const [card] = useAutoDetectionStore.getState().pendingSessions
    recordDetectionEvent.mockClear()
    useAutoDetectionStore.getState().dismissSession(card.id)
    expect(lastCall().slice(0, 3)).toEqual([ID, 'dismissed', 'user_card'])
    expect(useAutoDetectionStore.getState().pendingSessions).toHaveLength(0)
  })

  it('a pre-#2478 pending session (no detection id) still dismisses, reporting with no id', () => {
    useAutoDetectionStore.setState({ pendingSessions: [{
      id: 'legacy', startMs: t0, endMs: t0 + 600_000, routePolyline: '', distanceKm: 1, durationMin: 10,
      activityType: 'walk', source: 'phone',
    }] })
    useAutoDetectionStore.getState().dismissSession('legacy')
    expect(lastCall()[0]).toBeUndefined()
    expect(useAutoDetectionStore.getState().pendingSessions).toHaveLength(0)
  })
})
