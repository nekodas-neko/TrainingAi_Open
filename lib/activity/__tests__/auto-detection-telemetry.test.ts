// @vitest-environment jsdom
// #2478. The detection service's funnel events, driven through the real service with its device
// edges (motion sensor, GPS watcher, ring gate feed, notifications) replaced. Asserts what is
// reported AND that the detection outcome is the one the service produced before reporting existed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const recordDetectionEvent = vi.fn()
let idSeq = 0
vi.mock('../detection-events', () => ({
  recordDetectionEvent: (...args: unknown[]) => recordDetectionEvent(...args),
  newDetectionId: () => `00000000-0000-4000-8000-${String(++idSeq).padStart(12, '0')}`,
  flushDetectionEvents: vi.fn(async () => {}),
}))

let motionCb: (() => void) | null = null
vi.mock('../motion-detection', () => ({
  isMotionDetectionAvailable: () => true,
  armMotionTrigger: (cb: () => void) => { motionCb = cb; return true },
  disarmMotionTrigger: () => { motionCb = null },
}))

let pointCb: ((p: { t: number; lat: number; lng: number }) => void) | null = null
const watcherStop = vi.fn(async () => {})
vi.mock('../gps-tracking', () => ({
  startGpsWatcher: async (onPoint: typeof pointCb) => { pointCb = onPoint; return { stop: watcherStop } },
}))

vi.mock('@/lib/oura-ble/gate-feed', () => ({ subscribeGateFeed: async () => () => {} }))
const notifyActivityDetected = vi.fn(async () => {})
vi.mock('@/lib/notifications', () => ({
  notifyActivityDetected: () => notifyActivityDetected(),
  clearActivityDetected: async () => {},
}))
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: () => {} }) } }))
vi.mock('../steps-decoder-constants-client', () => ({ ensureStepsDecoderConstants: async () => false }))

import { startAutoDetection, stopAutoDetection } from '../auto-detection-service'
import { useAutoDetectionStore } from '@/lib/stores/auto-detection-store'
import { PROBE_TIMEOUT_MS } from '../motion-gate'

const T0 = Date.UTC(2026, 9, 7, 6, 0, 0)
const events = () => recordDetectionEvent.mock.calls.map(c => `${c[1]}:${c[2]}`)

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  recordDetectionEvent.mockClear()
  notifyActivityDetected.mockClear()
  idSeq = 0
  motionCb = null
  pointCb = null
  useAutoDetectionStore.setState({
    sessionStartMs: null, sessionPoints: [], pendingSessions: [], pendingActivityType: null, sessionDetectionId: null,
  })
  await startAutoDetection()
})
afterEach(async () => {
  await stopAutoDetection()
  vi.useRealTimers()
})

describe('auto-detection funnel events (#2478)', () => {
  it('a phone-motion probe that never moves reports candidate then probe_timeout', async () => {
    expect(motionCb).not.toBeNull()
    motionCb!()
    await vi.advanceTimersByTimeAsync(0)
    expect(pointCb).not.toBeNull()
    expect(events()).toEqual(['candidate:phone_motion'])

    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS + 30_000)
    expect(events()).toEqual(['candidate:phone_motion', 'dismissed:probe_timeout'])
    // Same detection id on both, and the outcome is the one it always was: GPS off, no session.
    expect(recordDetectionEvent.mock.calls[0][0]).toBe(recordDetectionEvent.mock.calls[1][0])
    expect(watcherStop).toHaveBeenCalled()
    expect(useAutoDetectionStore.getState().sessionStartMs).toBeNull()
  })

  it('a sensor-path walk reports candidate, confirmed by gps_speed, then notified', async () => {
    motionCb!()
    await vi.advanceTimersByTimeAsync(0)
    // ~1.4 m/s for 3 minutes, a point every 10 s.
    for (let i = 0; i <= 18; i++) {
      vi.setSystemTime(T0 + i * 10_000)
      pointCb!({ t: T0 + i * 10_000, lat: -27.47 + i * 0.000126, lng: 153.02 })
    }
    expect(events()).toEqual(['candidate:phone_motion', 'confirmed:gps_speed', 'notified:gps_distance_elapsed'])
    const ids = new Set(recordDetectionEvent.mock.calls.map(c => c[0]))
    expect(ids.size).toBe(1)
    expect(useAutoDetectionStore.getState().sessionDetectionId).toBe([...ids][0])
    expect(notifyActivityDetected).toHaveBeenCalledTimes(1)
  })

  it('stopping detection mid-probe reports detection_stopped once', async () => {
    motionCb!()
    await vi.advanceTimersByTimeAsync(0)
    await stopAutoDetection()
    expect(events()).toEqual(['candidate:phone_motion', 'dismissed:detection_stopped'])
  })
})
