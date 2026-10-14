// #2471. GET /api/activity-detection/walks — today's walks in the ring's MET, minus what is logged.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authMock = vi.fn(async (): Promise<{ user: { id: string; timezone: string } } | null> => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } }))
vi.mock('@/auth', () => ({ auth: () => authMock() }))
const rateLimit = vi.fn(() => true)
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => rateLimit() }))

// 09:00 Brisbane on 2026-10-07; a walk 09:10–09:32 at 3 MET, one 0x50 sample per minute.
const T0 = Date.UTC(2026, 9, 6, 23, 0)
const MIN = 60_000
const met = Array.from({ length: 60 }, (_, i) => ({ tsMs: T0 + i * MIN, value: i >= 10 && i < 32 ? 3.0 : 1.2 }))
const repo = {
  getOuraDaytimeSignals: vi.fn(async () => ({ temp: [], met, still: [], motion: [] })),
  listSleepSessions: vi.fn(async () => [] as { sleepStart: Date; sleepEnd: Date }[]),
  getDaySessionSummaries: vi.fn(async () => [] as { startedAt: Date; completedAt?: Date }[]),
  listActivityLogs: vi.fn(async () => [] as { date: string; startTime?: string; endTime?: string; durationMin?: number }[]),
}
vi.mock('@/lib/data', () => ({ getRepositoryAsync: vi.fn(async () => repo) }))

import { GET } from '@/app/api/activity-detection/walks/route'

const get = (q = '?date=2026/10/07') => GET(new NextRequest(`http://x/api/activity-detection/walks${q}`))

beforeEach(() => {
  authMock.mockImplementation(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } }))
  rateLimit.mockImplementation(() => true)
  repo.listActivityLogs.mockImplementation(async () => [])
  repo.getDaySessionSummaries.mockImplementation(async () => [])
})

describe('GET /api/activity-detection/walks (#2471)', () => {
  it('returns the walk, dated in the user\'s day, never cached', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.json()).toEqual({
      date: '2026-10-07',
      walks: [{ startMs: T0 + 10 * MIN, endMs: T0 + 32 * MIN, durationMin: 22, meanMet: 3 }],
    })
  })

  it('leaves out a walk the user already logged, so a saved card does not come back', async () => {
    repo.listActivityLogs.mockImplementation(async () => [{ date: '2026-10-07', startTime: '09:10', endTime: '09:32', durationMin: 22 }])
    expect((await (await get()).json()).walks).toEqual([])
    // As the server actually returns it (Postgres time): found on pnpm dev, where a saved walk came
    // straight back because "14:23:00" did not parse.
    repo.listActivityLogs.mockImplementation(async () => [{ date: '2026-10-07', startTime: '09:10:00', endTime: '09:32:00', durationMin: 22 }])
    expect((await (await get()).json()).walks).toEqual([])
  })

  it('leaves out motion during a lifting session', async () => {
    repo.getDaySessionSummaries.mockImplementation(async () => [{ startedAt: new Date(T0), completedAt: new Date(T0 + 50 * MIN) }])
    expect((await (await get()).json()).walks).toEqual([])
  })

  it('passes each read the date in the form it takes', async () => {
    await get('?date=2026-10-07')
    // `getDaySessionSummaries` splits on '/': a dashed date built an Invalid Date on pnpm dev.
    expect(repo.getDaySessionSummaries).toHaveBeenLastCalledWith('u1', '2026/10/07', 'Australia/Brisbane')
    expect(repo.listActivityLogs).toHaveBeenLastCalledWith('u1', '2026-10-07', '2026-10-07')
    expect(repo.listSleepSessions).toHaveBeenLastCalledWith('u1', '2026-10-07', '2026-10-08')
  })

  it('accepts either date separator and refuses a malformed one', async () => {
    expect((await get('?date=2026-10-07')).status).toBe(200)
    expect((await get('?date=07-10-2026')).status).toBe(400)
    expect((await get('?date=2026/02/31')).status).toBe(400)
  })

  it('refuses without a session, and when rate-limited', async () => {
    authMock.mockImplementation(async () => null)
    expect((await get()).status).toBe(401)
    authMock.mockImplementation(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } }))
    rateLimit.mockImplementation(() => false)
    expect((await get()).status).toBe(429)
  })
})
