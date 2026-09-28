// LA-170 — the training-load verdict used to be computed only for an unfinished day. The route is
// asked about today, re-persists on every call, and a morning evaluation cannot clear the
// 720-minute MET floor, so every stored `insufficient_met` may have described a partial day.
// Now each write is stamped, and a read of today re-evaluates yesterday once, after it has ended.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
type Row = Record<string, unknown>

const upsertOuraDailyDerived = vi.fn(async (..._a: unknown[]) => undefined)
const getOuraDailyDerived = vi.fn(async (..._a: unknown[]) => [] as Row[])

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-1', timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getOuraDailyDerived: (...a: unknown[]) => getOuraDailyDerived(...a),
    getOuraDailySummary: async () => [],
    listBodyMetrics: async () => [],
    getUserById: async () => ({ dateOfBirth: '1990-01-01', sex: 'male' }),
    getOuraDaytimeSignals: async () => ({ met: [], temp: [] }),
    upsertOuraDailyDerived: (...a: unknown[]) => upsertOuraDailyDerived(...a),
  }),
}))

import { GET } from '../route'

const today = () => todayInTz(TZ)
const yesterday = () => shiftDateStr(today(), -1)
const writtenDays = () => upsertOuraDailyDerived.mock.calls.map(c => c[1])
/** Yesterday's stored row, as `getOuraDailyDerived` returns it for that day only. */
const yesterdayStampedAt = (at: Date | null) =>
  getOuraDailyDerived.mockImplementation(async (_u: unknown, from: unknown) =>
    from === yesterday() ? [{ day: yesterday(), trainingLoadEvaluatedAt: at }] : [])

beforeEach(() => {
  upsertOuraDailyDerived.mockClear()
  getOuraDailyDerived.mockReset()
  getOuraDailyDerived.mockResolvedValue([])
})

describe('/api/training-stress — a finished day gets a whole-day verdict (LA-170)', () => {
  it('stamps every write with when it was computed', async () => {
    yesterdayStampedAt(new Date())
    await GET(new Request('http://localhost/api/training-stress'))
    const patch = upsertOuraDailyDerived.mock.calls[0][2] as Row
    expect(patch.trainingLoadEvaluatedAt).toBeInstanceOf(Date)
  })

  it('re-evaluates yesterday when its verdict was stamped before yesterday ended', async () => {
    const duringYesterday = new Date(dateStrMidnightInTz(today(), TZ).getTime() - 6 * 3_600_000)
    yesterdayStampedAt(duringYesterday)
    await GET(new Request('http://localhost/api/training-stress'))
    await vi.waitFor(() => expect(writtenDays()).toContain(yesterday()))
  })

  it('re-evaluates yesterday when it was never evaluated at all', async () => {
    await GET(new Request('http://localhost/api/training-stress'))
    await vi.waitFor(() => expect(writtenDays()).toContain(yesterday()))
  })

  it('leaves yesterday alone once its verdict was computed after it ended', async () => {
    yesterdayStampedAt(new Date(dateStrMidnightInTz(today(), TZ).getTime() + 60_000))
    await GET(new Request('http://localhost/api/training-stress'))
    await new Promise(r => setTimeout(r, 50))
    expect(writtenDays()).toEqual([today()])
  })

  it('does not reach for yesterday when a specific date was asked for', async () => {
    const day = shiftDateStr(today(), -3)
    await GET(new Request(`http://localhost/api/training-stress?date=${day}`))
    await new Promise(r => setTimeout(r, 50))
    expect(writtenDays()).toEqual([day])
  })
})
