// #3087: Oura's own workouts reach the energy figure on the two other paths too — today's active
// energy in /api/body-metadata, and the past-day budgets achievements judge food-logged days by.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const TZ = 'Australia/Brisbane'

const state = vi.hoisted(() => ({ oura: [] as unknown[], logs: [] as unknown[] }))

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane', dateOfBirth: '1993-01-01', sex: 'male' } })),
}))
vi.mock('@/lib/data', () => {
  const repo = {
    listBodyMetrics: async (_u: string, _from: string, to: string) => [{ date: to, weightKg: 80, steps: 9000 }],
    listFoodLogs: async () => [],
    listActivityLogs: async () => state.logs,
    listFoodLogsSummary: async () => [],
    getWorkoutSessionsFrom: async () => [],
    getBodyFatCalibration: async () => null,
    getAvgBpmBySession: async () => new Map(),
    getOuraWorkouts: async () => state.oura,
    getUserById: async () => ({ heightCm: 180, sex: 'male', dateOfBirth: '1993-01-01', fitnessGoal: 'maintain' }),
    getUserGoals: async () => null,
    listMeasuredRmr: async () => [],
  }
  return { getRepository: async () => repo, getRepositoryAsync: async () => repo }
})

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/body-metadata/route'
import { pastDayCalorieBudgets } from '@/lib/achievements'
import { dateStrMidnightInTz, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'

const today = todayInTz(TZ)
const yesterday = shiftDateStr(today, -1)
// Workouts sit at local midday, so no zone edge moves them to another day.
// A run, not a walk: a walk costed at walking MET is worth exactly the walking-cadence steps it takes
// back out of the step term, so its net effect on the day is zero by design.
const runOn = (d: string) => {
  const noon = dateStrMidnightInTz(d, TZ).getTime() + 12 * 3_600_000
  return {
    id: d, day: d, activity: 'running', startDatetime: new Date(noon), endDatetime: new Date(noon + 40 * 60_000),
    calories: null, distanceM: null, intensity: null, source: 'confirmed', reviewed: false,
  }
}

async function todayActive() {
  const res = await GET(new NextRequest('http://localhost/api/body-metadata'))
  expect(res.status).toBe(200)
  return ((await res.json()) as { activeEnergyKcalToday: number }).activeEnergyKcalToday
}

describe('Oura workouts at the other call sites (#3087)', () => {
  beforeEach(() => { state.oura = []; state.logs = [] })

  it('/api/body-metadata adds today\'s Oura run to today\'s active energy', async () => {
    const without = await todayActive()
    state.oura = [runOn(today)]
    expect(await todayActive()).not.toBe(without)
  })

  // A log that crosses midnight is dated the day it started, so it is not among today's logs, but its
  // Oura copy starts after midnight and lands on today.
  it('/api/body-metadata: last night\'s 23:30-00:30 log keeps its Oura copy out of today', async () => {
    const midnight = dateStrMidnightInTz(today, TZ).getTime()
    const without = await todayActive()
    state.logs = [{
      id: 'late', userId: 'u1', date: yesterday, activityType: 'run', title: 'run',
      startTime: '23:30:00', endTime: '00:30:00', durationMin: 60, distanceKm: null, steps: null,
      caloriesBurned: null, createdAt: new Date(),
    }]
    state.oura = [{
      ...runOn(today), startDatetime: new Date(midnight + 5 * 60_000), endDatetime: new Date(midnight + 25 * 60_000),
    }]
    expect(await todayActive()).toBe(without)
  })

  it('past-day budgets move for the day of an Oura run', async () => {
    const before = await pastDayCalorieBudgets('u1', TZ, [yesterday])
    state.oura = [runOn(yesterday)]
    const after = await pastDayCalorieBudgets('u1', TZ, [yesterday])
    expect(before.get(yesterday)).not.toBeNull()
    expect(after.get(yesterday)).not.toBe(before.get(yesterday))
  })
})
