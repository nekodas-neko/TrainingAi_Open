// #3095: Health's 14-day Steps sparkline read each day's raw device count, while the Steps history on
// the same screen folds in treadmill steps, so the two disagreed on a treadmill day.
import { describe, it, expect, vi } from 'vitest'

const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', timezone: TZ } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'

// From the clock, never hardcoded; sessions start at local midday.
const today = todayInTz(TZ)
const yesterday = shiftDateStr(today, -1)
const twoBack = shiftDateStr(today, -2)

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getOuraDaily: async () => [],
    getOuraDailyDerived: async () => [],
    listBodyMetrics: async () => [{ date: today, steps: 9_000 }, { date: yesterday, steps: 8_000 }],
    getWorkoutSessionsFrom: async () => [],
    listActivityLogs: async () => [
      { date: today, activityType: 'treadmill', steps: 3_500, startTime: '12:00:00' },
      { date: yesterday, activityType: 'walk', steps: 4_100, startTime: '12:00:00' },
      { date: twoBack, activityType: 'treadmill', steps: 2_000, startTime: '12:00:00' },
    ],
  }),
}))

import { GET } from '@/app/api/health/trends/route'

describe('Health 14-day steps trend (#3095)', () => {
  it('adds treadmill steps, never a GPS walk\'s, and counts a treadmill-only day', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const { trends } = await res.json() as { trends: { date: string; steps: number | null }[] }
    const steps = Object.fromEntries(trends.map(t => [t.date, t.steps]))
    expect(steps[today]).toBe(12_500)
    expect(steps[yesterday]).toBe(8_000)
    expect(steps[twoBack]).toBe(2_000)
    expect(steps[shiftDateStr(today, -3)]).toBeNull()
  })
})
