// #3095: the day review's 8-day window read each day's steps raw from body_metrics, so a treadmill day
// read lower there than on Home. It now builds each day's count with the shared rule.
import { describe, it, expect, vi } from 'vitest'

const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', timezone: TZ } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

// Derived from the clock, never hardcoded; sessions start at local midday.
const today = todayInTz(TZ)
const yesterday = shiftDateStr(today, -1)
const twoBack = shiftDateStr(today, -2)

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    listBodyMetrics: async () => [
      { date: today, steps: 9_000 },
      { date: yesterday, steps: 8_000 },
    ],
    getWorkoutSessionsFrom: async () => [],
    listActivityLogs: async () => [
      { date: today, activityType: 'treadmill', steps: 3_500, startTime: '12:00:00' },
      { date: yesterday, activityType: 'walk', steps: 4_100, startTime: '12:00:00' },
      { date: twoBack, activityType: 'treadmill', steps: 2_000, startTime: '12:00:00' },
    ],
  }),
}))

import { GET } from '@/app/api/day-review/week-window/route'

describe('day review week window steps (#3095)', () => {
  it('adds treadmill steps, never a GPS walk\'s, and counts a treadmill-only day', async () => {
    const res = await GET(new Request(`http://localhost/api/day-review/week-window?date=${today}`))
    expect(res.status).toBe(200)
    const { days } = await res.json() as { days: { date: string; steps: number | null }[] }
    const steps = Object.fromEntries(days.map(d => [d.date, d.steps]))
    expect(steps[today]).toBe(12_500)
    expect(steps[yesterday]).toBe(8_000)
    expect(steps[twoBack]).toBe(2_000)
    expect(steps[shiftDateStr(today, -3)]).toBeNull()
  })
})
