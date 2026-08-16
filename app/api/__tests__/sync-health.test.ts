import { describe, it, expect, vi, beforeEach } from 'vitest'

// `activityTypes` is per-test so the seeded vocabulary can be varied — the guard's behaviour
// depends on whether the fallback row itself exists, which is the branch a fixed mock can't reach.
const mockRepo = vi.hoisted(() => ({
  activityTypes: [] as { id: string }[],
  saveActivityLog: vi.fn(),
}))

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: vi.fn(async () => ({
    upsertBodyMetrics: vi.fn(),
    saveActivityLog: mockRepo.saveActivityLog,
    saveSleepSession: vi.fn(),
    listActivityLogs: vi.fn(async () => []),
    listActivityTypes: vi.fn(async () => mockRepo.activityTypes),
  })),
}))

import { POST } from '@/app/api/sync-health/route'
import { NextRequest } from 'next/server'

const post = (body: unknown) => POST(new NextRequest('http://x/api/sync-health', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

describe('POST /api/sync-health validation', () => {
  it('400s when a daily metric has a non-numeric weight', async () => {
    const res = await post({ dailyMetrics: [{ date: '2026-07-01', weightKg: 'heavy' }] })
    expect(res.status).toBe(400)
  })

  it('400s when the dailyMetrics array exceeds the item cap', async () => {
    const res = await post({ dailyMetrics: Array.from({ length: 401 }, () => ({ date: '2026-07-01' })) })
    expect(res.status).toBe(400)
  })

  it('400s on an out-of-range value (weight > 500)', async () => {
    const res = await post({ dailyMetrics: [{ date: '2026-07-01', weightKg: 9000 }] })
    expect(res.status).toBe(400)
  })

  it('400s on an unknown extra field (strict)', async () => {
    const res = await post({ dailyMetrics: [{ date: '2026-07-01', weightKg: 80, bogus: 1 }] })
    expect(res.status).toBe(400)
  })

  it('400s on a non-JSON / null body (fail closed)', async () => {
    const res = await POST(new NextRequest('http://x/api/sync-health', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
    }))
    expect(res.status).toBe(400)
  })

  it('accepts a well-formed payload', async () => {
    const res = await post({
      dailyMetrics: [{ date: '2026-07-01', weightKg: 82.5, steps: 8000 }],
      exerciseSessions: [],
      sleepRecords: [],
    })
    expect(res.status).toBe(200)
  })

  it('accepts an empty payload (all arrays omitted)', async () => {
    const res = await post({})
    expect(res.status).toBe(200)
  })
})

// Q-25(a), shipped in #902 without a test. `activity_type` is an FK into `activity_types`, and the
// client maps Health Connect's exercise types to our slugs from its own table — which drifts the
// moment a type is renamed here. An unknown slug used to throw out of the exercise loop and 500 the
// route, losing the WHOLE flush including the records that were fine: the same poison-pill shape
// the implausibility guard already covered, through a different door.
describe('POST /api/sync-health — an unknown activityType must not sink the flush', () => {
  const session = (activityType: string, startTime = '07:00') => ({
    date: '2026-07-01', activityType, title: 'Morning walk',
    startTime, endTime: '07:30', durationMin: 30,
  })

  beforeEach(() => {
    mockRepo.saveActivityLog.mockClear()
    mockRepo.activityTypes = [{ id: 'walk' }, { id: 'other' }]
  })

  it('writes a seeded activityType through unchanged', async () => {
    const res = await post({ exerciseSessions: [session('walk')] })
    expect(res.status).toBe(200)
    expect((await res.json()).rejected).toEqual([])
    expect(mockRepo.saveActivityLog).toHaveBeenCalledTimes(1)
    expect(mockRepo.saveActivityLog.mock.calls[0][1]).toMatchObject({ activityType: 'walk' })
  })

  it('degrades an unseeded type to "other" rather than dropping a real session', async () => {
    const res = await post({ exerciseSessions: [session('walking')] })
    expect(res.status).toBe(200)

    // The session still lands — losing a real workout is worse than filing it imprecisely.
    expect(mockRepo.saveActivityLog).toHaveBeenCalledTimes(1)
    expect(mockRepo.saveActivityLog.mock.calls[0][1]).toMatchObject({ activityType: 'other' })

    // …but the degrade is reported, so a drifted client mapping stays visible rather than silent.
    const { rejected } = await res.json()
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toContain('walking')
    expect(rejected[0]).toContain('other')
  })

  it('does not let an unknown record strand a valid sibling in the same flush', async () => {
    const res = await post({
      exerciseSessions: [session('walking', '07:00'), session('walk', '09:00')],
    })
    expect(res.status).toBe(200)
    expect(mockRepo.saveActivityLog).toHaveBeenCalledTimes(2)
    expect(mockRepo.saveActivityLog.mock.calls.map(c => c[1].activityType)).toEqual(['other', 'walk'])
  })

  it('skips only the offending record when "other" itself is not seeded', async () => {
    mockRepo.activityTypes = [{ id: 'walk' }]
    const res = await post({
      exerciseSessions: [session('walking', '07:00'), session('walk', '09:00')],
    })
    expect(res.status).toBe(200)

    const { rejected } = await res.json()
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toContain('unknown activityType')
    expect(mockRepo.saveActivityLog).toHaveBeenCalledTimes(1)
    expect(mockRepo.saveActivityLog.mock.calls[0][1]).toMatchObject({ activityType: 'walk' })
  })
})
