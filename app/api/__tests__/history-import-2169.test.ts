// issue 2169 - the Health Connect history-import progress route, and the sync route's `historyFrom`.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  session: { user: { id: 'u1', timezone: 'Australia/Brisbane' } } as { user: { id: string; timezone?: string } } | null,
  limited: false,
  oldest: null as string | null,
}))
const repo = vi.hoisted(() => ({
  getHealthConnectHistoryOldest: vi.fn(),
  advanceHealthConnectHistoryOldest: vi.fn(),
  upsertBodyMetrics: vi.fn(),
  upsertAggregatorHeartrate: vi.fn(),
  upsertHealthConnectIntervals: vi.fn(async (_u: string, rows: unknown[]) => rows.length),
  saveSleepSession: vi.fn(),
  saveActivityLog: vi.fn(),
  listActivityLogs: vi.fn(async () => []),
  listActivityTypes: vi.fn(async () => []),
}))

vi.mock('@/auth', () => ({ auth: vi.fn(async () => state.session) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => !state.limited) }))
vi.mock('@/lib/data', () => ({ getRepositoryAsync: vi.fn(async () => repo) }))

import { GET, POST } from '@/app/api/health-connect/history-import/route'
import { POST as SYNC } from '@/app/api/sync-health/route'
import { NextRequest } from 'next/server'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const today = () => todayInTz(TZ)
const post = (body: unknown, raw?: string) => POST(new NextRequest('http://x/api/health-connect/history-import', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body),
}))

beforeEach(() => {
  state.session = { user: { id: 'u1', timezone: TZ } }
  state.limited = false
  vi.clearAllMocks()
  repo.getHealthConnectHistoryOldest.mockImplementation(async () => state.oldest)
  repo.advanceHealthConnectHistoryOldest.mockImplementation(async (_u: string, d: string) => d)
  repo.upsertHealthConnectIntervals.mockImplementation(async (_u: string, rows: unknown[]) => rows.length)
})

describe('GET /api/health-connect/history-import', () => {
  it('401s without a session', async () => {
    state.session = null
    expect((await GET()).status).toBe(401)
    expect(repo.getHealthConnectHistoryOldest).not.toHaveBeenCalled()
  })

  it('429s when rate limited', async () => {
    state.limited = true
    expect((await GET()).status).toBe(429)
  })

  it('reads the session user\'s own row - null before any import, the stored day after', async () => {
    state.oldest = null
    expect(await (await GET()).json()).toEqual({ oldestDate: null })
    state.oldest = '2026-06-12'
    expect(await (await GET()).json()).toEqual({ oldestDate: '2026-06-12' })
    expect(repo.getHealthConnectHistoryOldest).toHaveBeenCalledWith('u1')
  })
})

describe('POST /api/health-connect/history-import', () => {
  it('401s without a session, and writes nothing', async () => {
    state.session = null
    expect((await post({ oldestDate: '2026-06-12' })).status).toBe(401)
    expect(repo.advanceHealthConnectHistoryOldest).not.toHaveBeenCalled()
  })

  it('429s when rate limited, and writes nothing', async () => {
    state.limited = true
    expect((await post({ oldestDate: '2026-06-12' })).status).toBe(429)
    expect(repo.advanceHealthConnectHistoryOldest).not.toHaveBeenCalled()
  })

  it('stores the day for the session user - never an id from the body', async () => {
    const res = await post({ oldestDate: '2026-06-12' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ oldestDate: '2026-06-12' })
    expect(repo.advanceHealthConnectHistoryOldest).toHaveBeenCalledWith('u1', '2026-06-12')
  })

  it('accepts the client\'s slashed date and stores it as a dash date', async () => {
    const res = await post({ oldestDate: '2026/06/12' })
    expect(res.status).toBe(200)
    expect(repo.advanceHealthConnectHistoryOldest).toHaveBeenCalledWith('u1', '2026-06-12')
  })

  it('rejects a body carrying anything else (strict), including a userId', async () => {
    expect((await post({ oldestDate: '2026-06-12', userId: 'someone-else' })).status).toBe(400)
    expect(repo.advanceHealthConnectHistoryOldest).not.toHaveBeenCalled()
  })

  it.each([
    ['a non-date', { oldestDate: 'last year' }],
    ['a shape-valid non-day', { oldestDate: '2026-99-99' }],
    ['a number', { oldestDate: 20260612 }],
    ['a missing field', {}],
    ['a future day', { oldestDate: shiftDateStr(todayInTz(TZ), 2) }],
    ['a day older than an import goes', { oldestDate: '1999-01-01' }],
  ])('400s on %s', async (_n, body) => {
    expect((await post(body)).status).toBe(400)
    expect(repo.advanceHealthConnectHistoryOldest).not.toHaveBeenCalled()
  })

  it('400s on non-JSON, 413s on an oversized body', async () => {
    expect((await post(null, 'not json')).status).toBe(400)
    expect((await post(null, JSON.stringify({ oldestDate: '2026-06-12', pad: 'x'.repeat(2000) }))).status).toBe(413)
  })
})

describe('POST /api/sync-health - historyFrom', () => {
  const sync = (body: unknown) => SYNC(new NextRequest('http://x/api/sync-health', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  const DAY = 86_400_000
  const hr = (daysAgo: number) => ({ at: Date.now() - daysAgo * DAY, bpm: 70 })

  it('an ordinary sync still drops heart rate older than the cold window', async () => {
    const res = await sync({ heartRateSamples: [hr(60)] })
    expect((await res.json()).heartRateAccepted).toBe(0)
    expect(repo.upsertAggregatorHeartrate).not.toHaveBeenCalled()
  })

  it('an import window keeps heart rate and intervals from the window it announced', async () => {
    const from = shiftDateStr(today(), -62)
    const res = await sync({
      historyFrom: from,
      heartRateSamples: [hr(60)],
    })
    expect((await res.json()).heartRateAccepted).toBe(1)

    const res2 = await sync({
      historyFrom: from,
      activityIntervals: [{ kind: 'steps', startMs: Date.now() - 60 * DAY, endMs: Date.now() - 60 * DAY + 60_000, value: 90, recordId: 'r1' }],
    })
    expect((await res2.json()).intervalsAccepted).toBe(1)
  })

  it('does not widen beyond the announced window: a sample older than historyFrom is still dropped', async () => {
    const from = shiftDateStr(today(), -62)
    const res = await sync({ historyFrom: from, heartRateSamples: [hr(200)] })
    expect((await res.json()).heartRateAccepted).toBe(0)
  })

  it.each([
    ['a future day', shiftDateStr(todayInTz(TZ), 3)],
    ['a day beyond the ten-year limit', '1999-01-01'],
    ['a non-day', '2026-99-99'],
  ])('ignores %s, with a note, and keeps the ordinary window', async (_n, historyFrom) => {
    const res = await sync({ historyFrom, heartRateSamples: [hr(60)] })
    const json = await res.json()
    expect(json.heartRateAccepted).toBe(0)
    expect(json.rejected.some((r: string) => r.startsWith('historyFrom'))).toBe(true)
  })

  it('400s on a malformed historyFrom shape', async () => {
    expect((await sync({ historyFrom: 'last year' })).status).toBe(400)
  })
})
