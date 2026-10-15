/**
 * #2863. Four calorie figures summed logged food only while the Nutrition ring and the server's
 * `intakeKcal` added the counted plan-meal estimate: the 1.490.0 web walk saw "1,250 EATEN" on the
 * ring beside 600 on Home's Calories tile, "Eaten 600" in the day screen's energy caption, "Calories
 * 600 / 2,601" on Goals, and 700 instead of 1,350 in the logger's "Today after logging" line.
 *
 * Every one now reads `countedIntakeKcal`. This pins each to the ring's figure on the walk's day:
 * 600 kcal logged (breakfast and lunch) and a 650 kcal dinner estimated.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../scripts/lib/strip-comments.js'
import { shiftDateStr, todayInTz, startOfWeekInTz } from '@trainingai/shared/date-utils'
import { MAX_WINDOW_DAYS } from '@trainingai/shared/nutrition/adaptive-tdee'
import { countedIntakeKcal, countedEstimateTotal, readEstimateRows } from '@trainingai/shared/nutrition/counted-intake'
import type { MealType } from '@trainingai/shared/types/nutrition'

const TZ = 'Australia/Brisbane'
const TODAY = todayInTz(TZ)
const TYPES = [
  { id: 'breakfast', name: 'Breakfast', timeStartHour: 6, timeEndHour: 10 },
  { id: 'lunch', name: 'Lunch', timeStartHour: 12, timeEndHour: 15 },
  { id: 'dinner', name: 'Dinner', timeStartHour: 17, timeEndHour: 21 },
] as unknown as MealType[]
const PLAN_MEALS = [
  { id: 'pm-b', mealTypeId: 'breakfast', suggestedTime: '07:30' },
  { id: 'pm-l', mealTypeId: 'lunch', suggestedTime: '12:30' },
  { id: 'pm-d', mealTypeId: 'dinner', suggestedTime: '18:30' },
]
// Local midday anchors, per the date rules.
const LOGS = [
  { mealTypeId: 'breakfast', calories: 250, proteinG: 20, carbsG: 25, fatG: 8, loggedAt: `${TODAY}T08:00:00+10:00` },
  { mealTypeId: 'lunch', calories: 350, proteinG: 30, carbsG: 30, fatG: 12, loggedAt: `${TODAY}T12:30:00+10:00` },
]
const RING = 1250

const days = Array.from({ length: MAX_WINDOW_DAYS }, (_, i) => shiftDateStr(TODAY, -(i + 1)))
const fakeRepo = {
  listBodyMetrics: async () => [TODAY, ...days].map(date => ({ date, weightKg: 70, bodyFatPct: 25 })),
  listFoodLogsSummary: async (_u: string, from: string, to: string) =>
    [...days.map(date => ({ date, calories: 1800 })), { date: TODAY, calories: 600 }]
      .filter(r => r.date >= from && r.date <= to),
  listFoodLogs: async (_u: string, date: string) => (date === TODAY ? LOGS : []),
  listActivityLogs: async () => [],
  getWorkoutSessionsFrom: async () => [],
  getNutritionTargets: async () => ({ calories: 1700, proteinG: 150, carbsG: 150, fatG: 55 }),
  getUserGoals: async () => null,
  getUserById: async () => ({ heightCm: 170, sex: 'male', dateOfBirth: '1993-01-01', fitnessGoal: 'lose_fat' }),
  listDayCheckins: async () => [],
  getBodyFatCalibration: async () => null,
  getLatestMeasuredRmr: async () => null,
  getAvgBpmBySession: async () => new Map<string, number>(),
  listDoseHistory: async () => ({ logs: [], courses: [] }),
  listMealLoggingStatuses: async () => [],
  listPlanMealAnswers: async (_u: string, date: string) =>
    date === TODAY ? [{ planMealId: 'pm-d', answer: 'estimated', estCalories: 650 }] : [],
  getActiveMealPlan: async () => ({ variants: [{ dayType: 'all', meals: PLAN_MEALS }] }),
  listMealTypes: async () => TYPES,
}

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/data', () => ({ getRepository: async () => fakeRepo }))

import { NextRequest } from 'next/server'
import { computeEnergyBalance } from '@/lib/health/energy-balance-service'
import { GET as bodyMetadata } from '@/app/api/body-metadata/route'
import { buildEnergyTimeline } from '@/components/health/energy-timeline'

const repoArg = fakeRepo as unknown as Parameters<typeof computeEnergyBalance>[0]

describe('countedIntakeKcal', () => {
  const estimates = [{ mealTypeId: 'dinner', kcal: 650 }]
  it('is logged food plus the counted estimates', () => {
    expect(countedIntakeKcal({ loggedKcal: 600, estimates })).toBe(RING)
  })
  it('drops an estimate whose meal type has food logged since the rows were built', () => {
    expect(countedIntakeKcal({ loggedKcal: 1300, estimates, loggedMealTypeIds: ['lunch', 'dinner'] })).toBe(1300)
    expect(countedEstimateTotal(estimates, ['dinner'])).toBe(0)
  })
  it('rounds each half on its own, so logged + estimated on the wire equals intake', () => {
    expect(countedIntakeKcal({ loggedKcal: 600.4, estimates: [{ mealTypeId: 'dinner', kcal: 649.6 }] })).toBe(600 + 650)
  })
  it('reads nothing it cannot place from a malformed or older payload', () => {
    expect(readEstimateRows(undefined)).toEqual([])
    expect(readEstimateRows([{ kcal: 650 }, { mealTypeId: 'x', kcal: 'a' }, { mealTypeId: 'y', kcal: 0 }, null])).toEqual([])
    expect(readEstimateRows(estimates)).toEqual(estimates)
  })
})

describe('every calorie figure is the ring\'s (#2863)', () => {
  it('the server balance: intake is the counted intake, with the rows that built it', async () => {
    const r = await computeEnergyBalance(repoArg, 'u1', TZ, TODAY)
    expect(r.balance!.intakeKcal).toBe(RING)
    expect(r.balance!.loggedIntakeKcal + r.balance!.estimatedKcal).toBe(RING)
    expect(r.balance!.estimatedMeals).toEqual([{ mealTypeId: 'dinner', kcal: 650 }])
  })

  it("Home's Calories tile and Goals: body-metadata's today and week-to-date calories", async () => {
    const res = await bodyMetadata(new NextRequest('http://localhost/api/body-metadata'))
    const body = await res.json() as { today: { calories: number }; weekToDate: { calories: number } }
    expect(body.today.calories).toBe(RING)
    // The week: the earlier days' logged food plus today's counted intake, estimate included.
    const weekStart = startOfWeekInTz(TZ)
    const earlierDays = days.filter(d => d >= weekStart).length
    expect(body.weekToDate.calories).toBe(earlierDays * 1800 + RING)
  })

  it("the day screen's energy caption: the timeline's intake total", async () => {
    const r = await computeEnergyBalance(repoArg, 'u1', TZ, TODAY)
    const t = buildEnergyTimeline({
      dayStartMs: new Date(`${TODAY}T00:00:00+10:00`).getTime(),
      restingHr: 60, restingBaseKcal: 1700, activeKcal: 300, hr: [],
      intake: LOGS.map(l => ({ atMs: new Date(l.loggedAt).getTime(), kcal: l.calories })),
      estimates: readEstimateRows(r.balance!.estimatedMeals),
      intakeMealTypeIds: LOGS.map(l => l.mealTypeId),
    })
    expect(t.totals.intakeKcal).toBe(RING)
    expect(t.totals.estimatedKcal).toBe(650)
    // The drawn curve is logged food only: an assumed meal has no time to be drawn at.
    expect(t.buckets.at(-1)!.intakeCumKcal).toBe(600)
  })

  it('the logger\'s "Today after logging": a 100 kcal food logged to Dinner supersedes the dinner estimate', () => {
    const estimates = [{ mealTypeId: 'dinner', kcal: 650 }]
    const logged = LOGS.map(l => l.mealTypeId)
    // To lunch: the ring's 1,250 plus the food.
    expect(countedIntakeKcal({ loggedKcal: 600 + 100, estimates, loggedMealTypeIds: [...logged, 'lunch'] })).toBe(RING + 100)
    // To dinner: the food replaces the estimate, as logging it will.
    expect(countedIntakeKcal({ loggedKcal: 600 + 100, estimates, loggedMealTypeIds: [...logged, 'dinner'] })).toBe(700)
  })
})

describe('the surfaces read the shared sum, not a sum of their own', () => {
  const ROOT = path.resolve(__dirname, '../..')
  const read = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), 'utf8'))
  it.each([
    'components/nutrition/assign-step.tsx',
    'components/health/energy-timeline.ts',
    'app/api/body-metadata/route.ts',
    'lib/health/energy-balance-service.ts',
    'mobile/src/features/nutrition/data/recorded-intake.ts',
    'mobile/src/features/nutrition/components/FoodLogger.tsx',
  ])('%s calls countedIntakeKcal', rel => {
    expect(read(rel)).toMatch(/countedIntakeKcal\(/)
  })
  it('the logger preview no longer adds the food to a logged-only total', () => {
    expect(read('components/nutrition/assign-step.tsx')).not.toMatch(/todayCalories\s*\+\s*effectiveCals/)
  })
})
