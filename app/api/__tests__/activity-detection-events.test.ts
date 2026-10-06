// #2478. POST /api/activity-detection/events — walk auto-detection's funnel. Each guard case is
// built to fail on THAT guard only (every other field valid).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DetectionEventWrite } from '@/lib/data/repository'

const authMock = vi.fn(async (): Promise<{ user: { id: string } } | null> => ({ user: { id: 'u1' } }))
vi.mock('@/auth', () => ({ auth: () => authMock() }))
const rateLimit = vi.fn((_key: string, _max: number, _windowMs: number) => true)
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (k: string, m: number, w: number) => rateLimit(k, m, w) }))
const insertDetectionEvents = vi.fn(async (_userId: string, events: DetectionEventWrite[]) => events.length)
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: vi.fn(async () => ({ insertDetectionEvents })),
}))

import { POST } from '@/app/api/activity-detection/events/route'

const post = (body: unknown) => POST(new Request('http://x/api/activity-detection/events', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

const DETECTION = '3f2c8a4e-5b1d-4c7a-9e2f-0a1b2c3d4e5f'
const AT = Date.UTC(2026, 9, 7, 7, 15, 0)
const START = AT - 600_000
const offered = {
  detectionId: DETECTION,
  kind: 'offered',
  gate: 'quality_gates',
  occurredAt: AT,
  trigger: 'ring',
  activityType: 'walk',
  sessionStartAt: START,
  distanceM: 812.5,
  elapsedSec: 600,
  pointCount: 41,
  avgSpeedMs: 1.35,
}

beforeEach(() => {
  insertDetectionEvents.mockClear()
  rateLimit.mockClear()
  rateLimit.mockImplementation(() => true)
  authMock.mockImplementation(async () => ({ user: { id: 'u1' } }))
})

describe('POST /api/activity-detection/events (#2478)', () => {
  it('persists every field for the session user, with instants as Dates', async () => {
    const res = await post({ events: [offered] })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.json()).toEqual({ ok: true, inserted: 1 })
    expect(insertDetectionEvents).toHaveBeenCalledWith('u1', [{
      detectionId: DETECTION,
      kind: 'offered',
      gate: 'quality_gates',
      occurredAt: new Date(AT),
      triggerSource: 'ring',
      activityType: 'walk',
      sessionStartAt: new Date(START),
      distanceM: 812.5,
      elapsedSec: 600,
      pointCount: 41,
      avgSpeedMs: 1.35,
    }])
    expect(rateLimit.mock.calls[0][0]).toBe('detection-events:u1')
  })

  it('stores a bare event with every optional field null', async () => {
    const res = await post({ events: [{ detectionId: DETECTION, kind: 'candidate', gate: 'phone_motion', occurredAt: AT }] })
    expect(res.status).toBe(200)
    const [row] = insertDetectionEvents.mock.calls[0][1]
    expect(row.triggerSource).toBeNull()
    expect(row.sessionStartAt).toBeNull()
    expect(row.distanceM).toBeNull()
    expect(row.pointCount).toBeNull()
  })

  it('records a gate the docs have never listed', async () => {
    const res = await post({ events: [{ ...offered, kind: 'dismissed', gate: 'some_new_rule' }] })
    expect(res.status).toBe(200)
    expect(insertDetectionEvents.mock.calls[0][1][0].gate).toBe('some_new_rule')
  })

  it('normalises the detection id to lower case so a retry cannot slip past the unique key', async () => {
    await post({ events: [{ ...offered, detectionId: DETECTION.toUpperCase() }] })
    expect(insertDetectionEvents.mock.calls[0][1][0].detectionId).toBe(DETECTION)
  })

  it('401s without a session and writes nothing', async () => {
    authMock.mockImplementation(async () => null)
    const res = await post({ events: [offered] })
    expect(res.status).toBe(401)
    expect(insertDetectionEvents).not.toHaveBeenCalled()
  })

  it('429s when the rate limit is spent', async () => {
    rateLimit.mockImplementation(() => false)
    const res = await post({ events: [offered] })
    expect(res.status).toBe(429)
    expect(insertDetectionEvents).not.toHaveBeenCalled()
  })

  it('400s on an unknown kind', async () => {
    const res = await post({ events: [{ ...offered, kind: 'maybe' }] })
    expect(res.status).toBe(400)
    expect(insertDetectionEvents).not.toHaveBeenCalled()
  })

  it('400s on a gate that is not a short slug', async () => {
    expect((await post({ events: [{ ...offered, gate: 'Quality Gates' }] })).status).toBe(400)
    expect((await post({ events: [{ ...offered, gate: 'x'.repeat(41) }] })).status).toBe(400)
  })

  it('400s on a detection id that is not a UUID', async () => {
    const res = await post({ events: [{ ...offered, detectionId: 'abc' }] })
    expect(res.status).toBe(400)
  })

  it('400s on an unknown field (strict), at either level', async () => {
    expect((await post({ events: [{ ...offered, userId: 'u2' }] })).status).toBe(400)
    expect((await post({ events: [offered], userId: 'u2' })).status).toBe(400)
    expect(insertDetectionEvents).not.toHaveBeenCalled()
  })

  it('400s on a negative measurement and an instant past the Date range', async () => {
    expect((await post({ events: [{ ...offered, distanceM: -1 }] })).status).toBe(400)
    expect((await post({ events: [{ ...offered, occurredAt: 8_640_000_000_000_001 }] })).status).toBe(400)
  })

  it('400s on an empty batch and on one over 50 events', async () => {
    expect((await post({ events: [] })).status).toBe(400)
    const many = Array.from({ length: 51 }, () => offered)
    expect((await post({ events: many })).status).toBe(400)
  })

  it('400s on a non-JSON body', async () => {
    const res = await POST(new Request('http://x/api/activity-detection/events', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope',
    }))
    expect(res.status).toBe(400)
  })
})
