// Issue 2740: /api/training-load carries the 28:90 block trend. Synthetic sessions, mocked repo.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz, shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const getSessionLoadsFrom = vi.fn(async (..._a: unknown[]) => [] as { startedAt: Date; volume: number }[])

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-1', timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getSessionLoadsFrom: (...a: unknown[]) => getSessionLoadsFrom(...a),
    getActiveProgram: async () => null,
  }),
}))

import { GET } from '../route'

const midday = (day: string) => new Date(dateStrMidnightInTz(day, TZ).getTime() + 12 * 3_600_000)
const every2 = (from: number) => {
  const today = todayInTz(TZ)
  return Array.from({ length: Math.floor((-from) / 2) + 1 }, (_, i) => ({ startedAt: midday(shiftDateStr(today, from + i * 2)), volume: 5000 }))
}

beforeEach(() => getSessionLoadsFrom.mockReset())

describe('GET /api/training-load blockTrend', () => {
  it('reads from the local midnight 90 days back, built on the date string', async () => {
    getSessionLoadsFrom.mockResolvedValue([])
    await GET()
    const from = getSessionLoadsFrom.mock.calls[0][1] as Date
    expect(from.getTime()).toBe(dateStrMidnightInTz(shiftDateStr(todayInTz(TZ), -90), TZ).getTime())
  })

  it('returns the ratio, band and a weekly line for a full history, and stays private, no-store', async () => {
    getSessionLoadsFrom.mockResolvedValue(every2(-90))
    const res = await GET()
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await res.json()
    expect(body.blockTrend.status).toBe('ok')
    expect(body.blockTrend.band).toBe('steady')
    expect(body.blockTrend.points).toHaveLength(10)
    expect(body.blockTrend.points.at(-1).ratio).toBeCloseTo(body.blockTrend.ratio, 10)
    // the 7:28 fields are still there
    expect(body).toHaveProperty('monotony')
    expect(body).toHaveProperty('interpretation')
  })

  it('answers not_enough_history, not a number, for a month of sessions', async () => {
    getSessionLoadsFrom.mockResolvedValue(every2(-29))
    const body = await (await GET()).json()
    expect(body.blockTrend).toEqual({ status: 'not_enough_history', ratio: null, band: null, baselineWeeklyKg: null, spanDays: expect.any(Number), points: [] })
  })
})
