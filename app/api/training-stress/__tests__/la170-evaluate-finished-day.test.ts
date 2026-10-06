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
const endOf = (day: string) => dateStrMidnightInTz(shiftDateStr(day, 1), TZ)
/** Stored rows for the look-back, as `getOuraDailyDerived` returns them for a range; a day not
 *  named is "never evaluated". The single-day reads inside an evaluation get nothing. */
const storedStamps = (stamps: Record<string, Date | null>) =>
  getOuraDailyDerived.mockImplementation(async (_u: unknown, from: unknown, to: unknown) =>
    from === to ? [] : Object.entries(stamps).map(([day, at]) => ({ day, trainingLoadEvaluatedAt: at })))
/** Every day in the look-back already final, so only the day under test can be stale. */
const allFinalExcept = (except: Record<string, Date | null>) => {
  const stamps: Record<string, Date | null> = {}
  for (let back = 1; back <= 7; back++) {
    const day = shiftDateStr(today(), -back)
    stamps[day] = new Date(endOf(day).getTime() + 60_000)
  }
  storedStamps({ ...stamps, ...except })
}
const yesterdayStampedAt = (at: Date | null) => allFinalExcept({ [yesterday()]: at })

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

  // #2400: only yesterday was ever re-checked, so a day the app was not opened after stayed on its
  // partial-day verdict. 2026-10-02 sat on a 06:25 verdict (grid 326) because 10-03 was never opened.
  it('re-evaluates an older day whose verdict was taken mid-day, not only yesterday', async () => {
    const missed = shiftDateStr(today(), -4)
    allFinalExcept({ [missed]: new Date(endOf(missed).getTime() - 17 * 3_600_000) })
    await GET(new Request('http://localhost/api/training-stress'))
    await vi.waitFor(() => expect(writtenDays()).toContain(missed))
    await new Promise(r => setTimeout(r, 50))
    expect(writtenDays().sort()).toEqual([missed, today()].sort())
  })

  it('looks back seven days and no further', async () => {
    const edge = shiftDateStr(today(), -7)
    const beyond = shiftDateStr(today(), -8)
    allFinalExcept({ [edge]: null, [beyond]: null })
    await GET(new Request('http://localhost/api/training-stress'))
    await vi.waitFor(() => expect(writtenDays()).toContain(edge))
    await new Promise(r => setTimeout(r, 50))
    expect(writtenDays()).not.toContain(beyond)
  })

  it('does not reach for yesterday when a specific date was asked for', async () => {
    const day = shiftDateStr(today(), -3)
    await GET(new Request(`http://localhost/api/training-stress?date=${day}`))
    await new Promise(r => setTimeout(r, 50))
    expect(writtenDays()).toEqual([day])
  })
})
