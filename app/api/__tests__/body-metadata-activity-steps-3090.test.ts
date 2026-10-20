// #3090: `/api/body-metadata` added every activity row's stored `steps` to the day's step count. Since
// Q-230 a GPS walk saves strap-cadence steps the ring already counted outdoors, so each one was
// counted twice. Only indoor activity (a treadmill walk) folds in now; whether the ring already counts
// some of its steps is unknown, pending #3112.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const TZ = 'Australia/Brisbane'

const repo = vi.hoisted(() => ({
  bodyMetrics: [] as { date: string; steps?: number }[],
  activityLogs: [] as Record<string, unknown>[],
}))

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1', timezone: TZ } })),
}))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    listBodyMetrics: async (_u: string, from: string, to: string) => repo.bodyMetrics
      .filter(m => m.date >= from && m.date <= to)
      .sort((a, b) => (a.date < b.date ? 1 : -1)),
    listFoodLogs:           async () => [],
    listActivityLogs:       async (_u: string, from: string, to: string) =>
      repo.activityLogs.filter(a => (a.date as string) >= from && (a.date as string) <= to),
    listFoodLogsSummary:    async () => [],
    getWorkoutSessionsFrom: async () => [],
    getBodyFatCalibration:  async () => null,
    getAvgBpmBySession:     async () => new Map(),
  }),
}))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/body-metadata/route'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'

// "Today" from the same helper the route uses, never a hardcoded date; the activities start at local
// midday so neither the day nor the week window can flip on a timezone edge.
const today = todayInTz(TZ)
const RING_STEPS = 9_000

const activity = (activityType: string, steps: number | null, distanceKm: number | null) => ({
  id: `${activityType}-${steps}`, userId: 'u1', date: today, activityType, title: activityType,
  startTime: '12:00:00', endTime: '12:40:00', durationMin: 40, distanceKm, steps,
  caloriesBurned: 150, createdAt: new Date(),
})

async function get() {
  const res = await GET(new NextRequest('http://localhost/api/body-metadata'))
  expect(res.status).toBe(200)
  return res.json() as Promise<{
    today: { steps: number | null; deviceSteps?: number | null } | null
    recent: { date: string; steps: number | null; deviceSteps?: number | null }[]
    weekToDate: { steps: number }
  }>
}

describe('#3090 the day step count does not add an outdoor walk the ring already counted', () => {
  beforeEach(() => {
    repo.bodyMetrics = [{ date: today, steps: RING_STEPS }]
    repo.activityLogs = []
  })

  it('a GPS walk with stored strap-cadence steps leaves the day and week step counts alone', async () => {
    repo.activityLogs = [activity('walk', 4_100, 3.2)]
    const body = await get()
    expect(body.today?.steps).toBe(RING_STEPS)
    expect(body.weekToDate.steps).toBe(RING_STEPS)
  })

  it('a GPS run with stored steps does too', async () => {
    repo.activityLogs = [activity('run', 5_600, 6)]
    const body = await get()
    expect(body.today?.steps).toBe(RING_STEPS)
  })

  it('a treadmill session still adds its steps', async () => {
    repo.activityLogs = [activity('treadmill', 3_500, 2.8)]
    const body = await get()
    expect(body.today?.steps).toBe(RING_STEPS + 3_500)
    // #3095: the device's own count rides alongside, for the log sheets to seed from.
    expect(body.today?.deviceSteps).toBe(RING_STEPS)
    expect(body.weekToDate.steps).toBe(RING_STEPS + 3_500)
  })

  // #3095: Health's Steps history and Home's sparkline read `recent`; it folds the same way.
  it('folds an earlier day\'s treadmill session into its recent row', async () => {
    const yesterday = shiftDateStr(today, -1)
    repo.bodyMetrics = [{ date: today, steps: RING_STEPS }, { date: yesterday, steps: 8_000 }]
    repo.activityLogs = [{ ...activity('treadmill', 2_000, 1.6), date: yesterday }]
    const body = await get()
    const row = body.recent.find(r => r.date === yesterday)
    expect(row?.steps).toBe(10_000)
    expect(row?.deviceSteps).toBe(8_000)
    expect(body.recent.find(r => r.date === today)?.deviceSteps).toBeUndefined()
  })

  it('a day with both adds the treadmill only', async () => {
    repo.activityLogs = [activity('walk', 4_100, 3.2), activity('treadmill', 3_500, 2.8)]
    const body = await get()
    expect(body.today?.steps).toBe(RING_STEPS + 3_500)
  })

  it('a treadmill session on a day with no device steps still surfaces its own', async () => {
    repo.bodyMetrics = []
    repo.activityLogs = [activity('treadmill', 3_500, 2.8)]
    const body = await get()
    expect(body.today?.steps).toBe(3_500)
  })
})
