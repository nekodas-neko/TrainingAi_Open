// #2480: the Weight Trend card's slope was fitted to body-metadata's 7 `recent` rows while its
// approved mockup says 30 days. The route now serves `weightTrend` — every weigh-in in the last 30
// local days — and `recent` stays the 7 rows the sparkline, composition cards and metric sheets read.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const TZ = 'Australia/Brisbane'

const repo = vi.hoisted(() => ({
  bodyMetrics: [] as { date: string; weightKg?: number; steps?: number }[],
  historyFails: false,
}))

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1', timezone: TZ } })),
}))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    // Date-descending and bounded by [from, to], as the real repository is.
    listBodyMetrics: async (_u: string, from: string, to: string) => {
      if (repo.historyFails && from < shiftDateStr(todayInTz(TZ), -30)) throw new Error('read failed')
      return repo.bodyMetrics
        .filter(m => m.date >= from && m.date <= to)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
    },
    listFoodLogs:           async () => [],
    listActivityLogs:       async () => [],
    listFoodLogsSummary:    async () => [],
    getWorkoutSessionsFrom: async () => [],
    getBodyFatCalibration:  async () => null,
    getAvgBpmBySession:     async () => new Map(),
  }),
}))

import { GET } from '@/app/api/body-metadata/route'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { computeWeightRateKgPerWeek, WEIGHT_TREND_WINDOW_DAYS } from '@trainingai/shared/health/long-term-goal-progress'

const today = todayInTz(TZ)
const day = (back: number) => shiftDateStr(today, -back)

async function get() {
  const res = await GET()
  expect(res.status).toBe(200)
  return res.json() as Promise<{
    recent: { date: string }[]
    weightTrend: { date: string; weightKg: number }[] | null
  }>
}

describe('body-metadata weightTrend (#2480)', () => {
  beforeEach(() => {
    repo.historyFails = false
    // Weigh-ins on days 2, 9, 16, 23 and 29 back, then two outside the window; a weightless row
    // on day 1 (steps only) that must not become a point.
    repo.bodyMetrics = [
      { date: day(1), steps: 9000 },
      { date: day(2), weightKg: 79.2 },
      { date: day(9), weightKg: 79.8 },
      { date: day(16), weightKg: 80.4 },
      { date: day(23), weightKg: 81.0 },
      { date: day(29), weightKg: 81.6 },
      { date: day(30), weightKg: 99 },
      { date: day(60), weightKg: 99 },
    ]
  })

  it('carries every weigh-in from the last 30 local days, today included, and nothing older', async () => {
    expect(WEIGHT_TREND_WINDOW_DAYS).toBe(30)
    const body = await get()
    expect(body.weightTrend?.map(p => p.date).sort()).toEqual([day(29), day(23), day(16), day(9), day(2)])
    expect(body.weightTrend?.every(p => typeof p.weightKg === 'number')).toBe(true)
  })

  it('leaves `recent` on its 7 days, so the sparkline and the other cards do not move', async () => {
    const body = await get()
    expect(body.recent.map(r => r.date)).toEqual([day(1), day(2)])
  })

  it('gives the slope a figure the 7-day rows could not', async () => {
    const body = await get()
    // One weigh-in in the week: no slope. Five across the month: −0.6 kg/wk.
    expect(computeWeightRateKgPerWeek(body.recent as never)).toBeNull()
    expect(computeWeightRateKgPerWeek(body.weightTrend!)).toBe(-0.6)
  })

  it('sends null, not an empty month, when the history read fails', async () => {
    repo.historyFails = true
    const body = await get()
    expect(body.weightTrend).toBeNull()
  })
})
