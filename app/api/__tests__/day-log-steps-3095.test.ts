// #3095: the day screen showed the ring's step count alone, so on a treadmill day it disagreed with
// Home, which adds the session's steps. It now builds the figure with the same shared builder.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const TZ = 'Australia/Brisbane'

const repo = vi.hoisted(() => ({
  steps: null as number | null,
  activityLogs: [] as Record<string, unknown>[],
}))

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', timezone: TZ } })) }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getDayLog: async () => [],
    listBodyMetrics: async (_u: string, from: string) => [{ date: from, steps: repo.steps, weightKg: 80 }],
    getBodyFatCalibration: async () => null,
    listSleepSessions: async () => [],
    getDerivedScoresForDay: async () => null,
    getHrForWindow: async () => [],
    listActivityLogs: async () => repo.activityLogs,
    getOuraDailySummary: async () => [],
  }),
}))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/day-log/route'
import { todayInTz } from '@trainingai/shared/date-utils'

const day = todayInTz(TZ)
// Sessions start at local midday so the day cannot flip on a timezone edge.
const activity = (activityType: string, steps: number) => ({
  id: activityType, userId: 'u1', date: day, activityType, title: activityType,
  startTime: '12:00:00', endTime: '12:40:00', durationMin: 40, distanceKm: 3, steps, createdAt: new Date(),
})

async function steps() {
  const res = await GET(new NextRequest(`http://localhost/api/day-log?date=${day}`))
  expect(res.status).toBe(200)
  return ((await res.json()) as { bodyMeta: { steps: number | null } | null }).bodyMeta?.steps
}

describe('day screen step count (#3095)', () => {
  beforeEach(() => { repo.steps = 9_000; repo.activityLogs = [] })

  it('adds a treadmill session the ring could not see', async () => {
    repo.activityLogs = [activity('treadmill', 3_500)]
    expect(await steps()).toBe(12_500)
  })

  it('does not add a GPS walk the ring already counted', async () => {
    repo.activityLogs = [activity('walk', 4_100)]
    expect(await steps()).toBe(9_000)
  })

  it('keeps a missing device count missing when there is nothing indoor', async () => {
    repo.steps = null
    expect(await steps()).toBeNull()
  })
})
