/**
 * #2122 step 8′(3): an assumed plan meal joins TODAY's intake — `intakeKcal`, reported separately as
 * `estimatedKcal` — and never the maintenance window, which learns from logged food alone. Logging a
 * meal of the estimated slot's type later supersedes the assumption, so the food is not counted twice.
 */
import { describe, it, expect } from 'vitest'
import { computeEnergyBalance } from '@/lib/health/energy-balance-service'
import { countedEstimateKcal } from '@trainingai/shared/nutrition/meal-estimate'
import { MAX_WINDOW_DAYS } from '@trainingai/shared/nutrition/adaptive-tdee'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import type { MealType } from '@trainingai/shared/types/nutrition'

const TZ = 'Australia/Brisbane'
const DATE = '2026-09-13'
const TYPES = [
  { id: 'breakfast', name: 'Breakfast', timeStartHour: 6, timeEndHour: 10 },
  { id: 'lunch', name: 'Lunch', timeStartHour: 12, timeEndHour: 15 },
] as unknown as MealType[]
const PLAN_MEALS = [
  { id: 'pm-b', mealTypeId: 'breakfast', suggestedTime: '07:30' },
  { id: 'pm-l', mealTypeId: 'lunch', suggestedTime: '12:30' },
]
const est = (planMealId: string, estCalories: number) => ({ planMealId, answer: 'estimated', estCalories })

describe('countedEstimateKcal', () => {
  it('counts an estimate while its slot has nothing logged', () => {
    expect(countedEstimateKcal({ answers: [est('pm-b', 450), est('pm-l', 600)], planMeals: PLAN_MEALS, mealTypes: TYPES, loggedMealTypeIds: new Set() })).toBe(1050)
  })
  it("a log of the slot's type supersedes the estimate", () => {
    expect(countedEstimateKcal({ answers: [est('pm-b', 450), est('pm-l', 600)], planMeals: PLAN_MEALS, mealTypes: TYPES, loggedMealTypeIds: new Set(['lunch']) })).toBe(450)
  })
  it('ignores declines, and an estimate whose plan meal is gone', () => {
    const answers = [{ planMealId: 'pm-b', answer: 'no', estCalories: null }, est('pm-gone', 300)]
    expect(countedEstimateKcal({ answers, planMeals: PLAN_MEALS, mealTypes: TYPES, loggedMealTypeIds: new Set() })).toBe(0)
  })
})

describe('computeEnergyBalance with an estimated meal', () => {
  const days = Array.from({ length: MAX_WINDOW_DAYS }, (_, i) => shiftDateStr(DATE, -(i + 1)))
  const repo = (answers: unknown[], todayLogs: { mealTypeId: string }[] = []) => ({
    listBodyMetrics: async () => [DATE, ...days].map(date => ({ date, weightKg: 70, bodyFatPct: 25 })),
    listFoodLogsSummary: async () => [...days.map(date => ({ date, calories: 1800 })), { date: DATE, calories: 500 }],
    listActivityLogs: async () => [],
    getWorkoutSessionsFrom: async () => [],
    getNutritionTargets: async () => ({ calories: 1700, proteinG: 150, carbsG: 150, fatG: 55 }),
    getUserGoals: async () => null,
    getUserById: async () => ({ heightCm: 170, sex: 'male', dateOfBirth: '1993-01-01', fitnessGoal: 'lose_fat' }),
    listDayCheckins: async () => days.map(logDate => ({ logDate, foodLoggingCompletedAt: new Date('2026-09-01T12:00:00Z') })),
    getBodyFatCalibration: async () => null,
    getLatestMeasuredRmr: async () => null,
    getAvgBpmBySession: async () => new Map<string, number>(),
    listDoseHistory: async () => ({ logs: [], courses: [] }),
    listMealLoggingStatuses: async () => [],
    listPlanMealAnswers: async () => answers,
    getActiveMealPlan: async () => ({ variants: [{ dayType: 'all', meals: PLAN_MEALS }] }),
    listMealTypes: async () => TYPES,
    listFoodLogs: async () => todayLogs,
  }) as unknown as Parameters<typeof computeEnergyBalance>[0]

  it("adds the estimate to today's intake and reports it", async () => {
    const base = await computeEnergyBalance(repo([]), 'u', TZ, DATE)
    const withEst = await computeEnergyBalance(repo([est('pm-l', 600)]), 'u', TZ, DATE)
    expect(base.balance!.estimatedKcal).toBe(0)
    expect(withEst.balance!.estimatedKcal).toBe(600)
    expect(withEst.balance!.intakeKcal).toBe(base.balance!.intakeKcal + 600)
    // The maintenance estimate learns from logged food only: unchanged by an assumption.
    expect(withEst.maintenance).toEqual(base.maintenance)
  })

  it('does not count it once the slot has a real log', async () => {
    const r = await computeEnergyBalance(repo([est('pm-l', 600)], [{ mealTypeId: 'lunch' }]), 'u', TZ, DATE)
    expect(r.balance!.estimatedKcal).toBe(0)
  })

  it('a failed read counts nothing rather than failing the balance', async () => {
    const r0 = repo([est('pm-l', 600)]) as unknown as Record<string, unknown>
    r0.getActiveMealPlan = async () => { throw new Error('db down') }
    const r = await computeEnergyBalance(r0 as never, 'u', TZ, DATE)
    expect(r.balance!.estimatedKcal).toBe(0)
  })
  it('keeps native per-meal tracking based on recorded food even when legacy estimates exist', async () => {
    const tracked = repo([est('pm-l',600)]);
    tracked.listMealLoggingStatuses = async () => [{mealTypeId:'lunch',status:'not_recorded'}] as never;
    const result = await computeEnergyBalance(tracked,'u',TZ,DATE);
    expect(result.balance!.estimatedKcal).toBe(0);
    expect(result.balance!.intakeKcal).toBe(500);
    expect(result.balance!.loggedIntakeKcal).toBe(500);
  });

})
