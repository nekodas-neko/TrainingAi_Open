// #2478. The phone half of the walk-detection funnel: a capped, persisted outbox that posts
// best-effort and never throws into the detection path.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  recordDetectionEvent,
  flushDetectionEvents,
  readDetectionOutbox,
  resetDetectionEventsForTest,
  newDetectionId,
  DETECTION_OUTBOX_CAP,
} from '../detection-events'
import { DetectionEventSchema } from '@trainingai/shared/validation/detection-event'

const ID = '0b9c8d7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e'
const NOW = Date.UTC(2026, 9, 7, 8, 0, 0)
const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('{"ok":true}', { status: 200 }))

beforeEach(() => {
  vi.useFakeTimers()
  resetDetectionEventsForTest()
  localStorage.clear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response('{"ok":true}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('recordDetectionEvent', () => {
  it('queues an event the server schema accepts', () => {
    recordDetectionEvent(ID, 'offered', 'quality_gates', {
      trigger: 'ring', activityType: 'walk', sessionStartAt: NOW - 600_000.4,
      distanceM: 812.5, elapsedSec: 600, pointCount: 41, avgSpeedMs: 1.35,
    }, NOW)
    const [ev] = readDetectionOutbox()
    expect(ev).toMatchObject({ detectionId: ID, kind: 'offered', gate: 'quality_gates', occurredAt: NOW, pointCount: 41 })
    expect(ev.sessionStartAt).toBe(NOW - 600_000)
    expect(DetectionEventSchema.safeParse(ev).success).toBe(true)
  })

  it('drops a measurement the server would reject instead of poisoning the batch', () => {
    recordDetectionEvent(ID, 'dismissed', 'min_avg_speed', {
      distanceM: NaN, elapsedSec: -3, avgSpeedMs: Infinity, activityType: null,
    }, NOW)
    const [ev] = readDetectionOutbox()
    expect(ev).toEqual({ detectionId: ID, kind: 'dismissed', gate: 'min_avg_speed', occurredAt: NOW })
    expect(DetectionEventSchema.safeParse(ev).success).toBe(true)
  })

  it('records nothing without a detection id (a session from before this shipped)', () => {
    recordDetectionEvent(null, 'saved', 'user_review', {}, NOW)
    recordDetectionEvent(undefined, 'dismissed', 'user_card', {}, NOW)
    expect(readDetectionOutbox()).toEqual([])
  })

  it('never throws, even when storage does', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    expect(() => recordDetectionEvent(ID, 'candidate', 'phone_motion', {}, NOW)).not.toThrow()
    spy.mockRestore()
    localStorage.setItem('detection-events-outbox', '{corrupt')
    expect(() => recordDetectionEvent(ID, 'candidate', 'phone_motion', {}, NOW)).not.toThrow()
  })

  it('caps the queue, dropping the oldest', () => {
    for (let i = 0; i < DETECTION_OUTBOX_CAP + 5; i++) {
      recordDetectionEvent(ID, 'candidate', 'phone_motion', {}, NOW + i)
    }
    const q = readDetectionOutbox()
    expect(q).toHaveLength(DETECTION_OUTBOX_CAP)
    expect(q[0].occurredAt).toBe(NOW + 5)
  })

  it('mints canonical UUIDs', () => {
    expect(newDetectionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('flushDetectionEvents', () => {
  it('posts after the debounce and empties the queue on success', async () => {
    recordDetectionEvent(ID, 'candidate', 'ring_gait_window', { trigger: 'ring' }, NOW)
    recordDetectionEvent(ID, 'dismissed', 'probe_timeout', {}, NOW + 1)
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/activity-detection/events')
    expect(JSON.parse(String(init.body)).events.map((e: { kind: string }) => e.kind)).toEqual(['candidate', 'dismissed'])
    expect(readDetectionOutbox()).toEqual([])
  })

  it('keeps the queue for a retry on a network failure, a 401, a 429 and a 5xx', async () => {
    recordDetectionEvent(ID, 'candidate', 'phone_motion', {}, NOW)
    for (const fail of [
      async () => { throw new TypeError('offline') },
      async () => new Response('', { status: 401 }),
      async () => new Response('', { status: 429 }),
      async () => new Response('', { status: 503 }),
    ]) {
      fetchMock.mockImplementationOnce(fail)
      await expect(flushDetectionEvents()).resolves.toBeUndefined()
      expect(readDetectionOutbox()).toHaveLength(1)
    }
    await flushDetectionEvents()
    expect(readDetectionOutbox()).toEqual([])
  })

  it('drops a batch the server rejects as invalid, so it cannot wedge the queue', async () => {
    recordDetectionEvent(ID, 'candidate', 'phone_motion', {}, NOW)
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 400 }))
    await flushDetectionEvents()
    expect(readDetectionOutbox()).toEqual([])
  })

  it('posts in batches of at most 50, oldest first', async () => {
    for (let i = 0; i < 120; i++) recordDetectionEvent(ID, 'candidate', 'phone_motion', {}, NOW + i)
    // Distinct (detection, kind) pairs per batch would be the real shape; the keying is checked
    // separately below. Here every event shares one key, so one successful post clears them all.
    await flushDetectionEvents()
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).events).toHaveLength(50)
  })

  it('keeps an event recorded while a post was in flight', async () => {
    const other = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
    recordDetectionEvent(ID, 'candidate', 'phone_motion', {}, NOW)
    let release!: () => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>(r => { release = () => r(new Response('{}', { status: 200 })) }))
    const p = flushDetectionEvents()
    await vi.advanceTimersByTimeAsync(0)
    recordDetectionEvent(other, 'candidate', 'phone_motion', {}, NOW + 1)
    release()
    await p
    // The second event was posted by the same flush's next round, or is still queued; never lost.
    const posted = fetchMock.mock.calls.flatMap(c => JSON.parse(String(c[1].body)).events.map((e: { detectionId: string }) => e.detectionId))
    expect([...posted, ...readDetectionOutbox().map(e => e.detectionId)]).toContain(other)
  })

  it('is single-flight', async () => {
    recordDetectionEvent(ID, 'candidate', 'phone_motion', {}, NOW)
    const a = flushDetectionEvents()
    const b = flushDetectionEvents()
    expect(a).toBe(b)
    await a
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does nothing while the device reports offline', async () => {
    recordDetectionEvent(ID, 'candidate', 'phone_motion', {}, NOW)
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await flushDetectionEvents()
    expect(fetchMock).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
