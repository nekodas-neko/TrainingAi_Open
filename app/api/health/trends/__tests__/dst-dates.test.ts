// #2929: the 14-day trend stepped back with `todayMid - i*86_400_000`. A DST-change day is 23 or
// 25 h long, so across 2026-03-08 in New York one date was skipped and its neighbour repeated.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', timezone: 'America/New_York' } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getOuraDaily: async () => [],
    getOuraDailyDerived: async () => [],
    listBodyMetrics: async () => [],
    getWorkoutSessionsFrom: async () => [],
  }),
}))

describe('health/trends — dates across a DST change', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Local midday on 2026-03-09, the day after New York springs forward.
    vi.setSystemTime(new Date('2026-03-09T16:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('returns 14 distinct, consecutive local dates ending today', async () => {
    const { GET } = await import('../route')
    const { trends } = await (await GET()).json()
    const dates = trends.map((t: { date: string }) => t.date)
    expect(dates).toHaveLength(14)
    expect(new Set(dates).size).toBe(14)
    expect(dates[0]).toBe('2026-02-24')
    expect(dates[13]).toBe('2026-03-09')
    expect(dates).toContain('2026-03-08')
    for (let i = 1; i < dates.length; i++) {
      expect(Date.parse(dates[i]) - Date.parse(dates[i - 1])).toBe(86_400_000)
    }
  })
})
