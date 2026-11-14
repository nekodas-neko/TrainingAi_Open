// #3771. The route took `bodyMetrics.find(m => m.weightKg != null)`, the first row with a weight,
// which is the latest weigh-in only while `listBodyMetrics` returns newest first. It now picks by
// date (`latestWeightKg`), so the recommendation is the same whichever way the rows arrive.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const USER = {
  id: '00000000-0000-4000-8000-000000003771', dateOfBirth: '1990-01-01', heightCm: 170, sex: 'male',
  activityLevel: 'moderate', timezone: TZ, fitnessGoal: 'recomp',
}

// "Today" from the helper the route uses; the rows sit on whole local days inside its 14-day window.
const today = todayInTz(TZ)
const OLDEST = { date: shiftDateStr(today, -10), weightKg: 95 }
const MIDDLE = { date: shiftDateStr(today, -5), weightKg: 85 }
const LATEST = { date: shiftDateStr(today, -1), weightKg: 75 }
// Today's row has steps and no weight, as on a morning before the weigh-in.
const TODAY_NO_WEIGHT = { date: today, steps: 4000 }

let rows: { date: string; weightKg?: number; steps?: number }[] = []

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: USER })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getUserById: async () => USER,
    getUserGoals: async () => ({ stepsGoal: 8000, stepsGoalType: 'manual', calorieGoal: 2000, calorieGoalType: 'manual', waterGoalMl: 2500, waterGoalType: 'manual' }),
    listActivityLogs: async () => [],
    getNutritionTargets: async () => ({ calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 }),
    // In the order the test set, on purpose: the order is the thing under test.
    listBodyMetrics: async () => rows,
    getWorkoutSessionsFrom: async () => [],
    listRecentPersonalRecords: async () => [],
    getActiveProgram: async () => null,
    listProgramPhases: async () => [],
    countSessionsSinceStart: async () => 0,
    getLatestMeasuredRmr: async () => null,
    getBodyFatCalibration: async () => null,
    createGoalRecommendation: async () => ({ id: 'rec-1' }),
  }),
}))

import { POST } from '../route'

async function recommended(input: typeof rows) {
  rows = input
  const res = await POST(new Request('http://t/api/nutrition-goals/recommend', { method: 'POST' }))
  expect(res.status).toBe(200)
  return (await res.json()).recommended as Record<string, number>
}

describe('#3771 the goal recommendation is built on the latest weigh-in by date', () => {
  beforeEach(() => { rows = [] })

  it('chooses the same weight with the rows newest first and oldest first', async () => {
    const fromLatestOnly = await recommended([LATEST])
    const descending = await recommended([TODAY_NO_WEIGHT, LATEST, MIDDLE, OLDEST])
    const ascending = await recommended([OLDEST, MIDDLE, LATEST, TODAY_NO_WEIGHT])
    expect(descending).toEqual(fromLatestOnly)
    expect(ascending).toEqual(fromLatestOnly)
  })

  // Without this the test above would pass on a route that ignored weight altogether.
  it('and the weight does move the recommendation', async () => {
    expect(await recommended([OLDEST])).not.toEqual(await recommended([LATEST]))
  })

  it('still answers no_weight_data when no row carries a weight', async () => {
    rows = [TODAY_NO_WEIGHT]
    const res = await POST(new Request('http://t/api/nutrition-goals/recommend', { method: 'POST' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'no_weight_data' })
  })
})
