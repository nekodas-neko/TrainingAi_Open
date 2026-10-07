/**
 * #2071 — "that one number appears everywhere the app shows a calorie budget. No screen shows a
 * different total." (owner, 2026-10-05)
 *
 * The unit tests in `calorie-budget.test.ts` pin the formula. This pins the CONTRACT: one fixture day,
 * every route a surface reads, the same number out of each. The client surfaces (Nutrition tab, Home's
 * nutrition and energy-balance cards, the log-food sheet, the end-of-day review, Health's goals card,
 * the weekly chart's reference line) all read `/api/nutrition/energy-balance` through
 * `budgetProvenance(balance).total`, so the route's payload stands in for them; the coach's two tools
 * and the end-of-day digest compute server-side and are called for real.
 *
 * It also pins the retirement: the typed `calorie_goal` (1,660 here, the owner's) moves none of them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { todayInTz } from '@trainingai/shared/date-utils'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'
import { calorieBudget, goalDeficitKcal } from '@trainingai/shared/nutrition/calorie-budget'
import { computeTrendWeightKg } from '@trainingai/shared/health/long-term-goal-progress'
import { shiftDateStr } from '@trainingai/shared/date-utils'

const USER_ID = '00000000-0000-4000-8000-000000002071'
const TZ = 'Australia/Brisbane'
const TODAY = todayInTz(TZ)

let weightKg = 70.3
/** Extra weigh-ins before today, for the trend-weight tests. */
let history: { date: string; weightKg: number }[] = []
let storedCalories = 1660
let targetWeightKg: number | null = 60
let digestPrompt = ''

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER_ID, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('ai', async (orig) => ({
  ...(await orig<typeof import('ai')>()),
  generateText: vi.fn(async (args: { prompt: string }) => {
    digestPrompt = args.prompt
    return { text: 'stub digest' }
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateText: async (_meta: unknown, run: () => Promise<{ text: string }>) => run(),
}))

const repo = {
  // energy balance
  listBodyMetrics: async () => [...history, { date: TODAY, weightKg, steps: 7000 }],
  listFoodLogsSummary: async () => [{ date: TODAY, calories: 900, proteinG: 70, carbsG: 80, fatG: 30 }],
  listActivityLogs: async () => [],
  getWorkoutSessionsFrom: async () => [],
  getNutritionTargets: async () => ({ calories: storedCalories, proteinG: 150, carbsG: 141, fatG: 55 }),
  getUserGoals: async () => ({
    stepsGoal: null, stepsGoalType: 'daily', sleepGoalHours: null,
    calorieGoal: storedCalories, calorieGoalType: 'daily',
    waterGoalMl: null, waterGoalType: null, targetWeightKg, targetBfPct: null,
  }),
  getUserById: async () => ({ heightCm: 158, sex: 'male', dateOfBirth: '1993-01-01', fitnessGoal: 'recomp' }),
  listDayCheckins: async () => [],
  getBodyFatCalibration: async () => null,
  getLatestMeasuredRmr: async () => ({ rmrKcal: 1325, ffmKgAtTest: null, measuredOn: '2026-08-27' }),
  getAvgBpmBySession: async () => new Map<string, number>(),
  listDoseHistory: async () => ({ logs: [], courses: [] }),
  // chat + digest
  listFoodLogs: async () => [{
    id: 'f1', date: TODAY, mealTypeId: 'm1', foodItemId: 'x',
    calories: 900, proteinG: 70, carbsG: 80, fatG: 30, foodItem: { name: 'Lunch' },
  }],
  getDaySessionSummaries: async () => [],
  listRecentPersonalRecords: async () => [],
  getActiveProgram: async () => null,
  getDayCheckin: async () => null,
  listExerciseLibrary: async () => [],
  getAiHealthInsightWithHash: async () => null,
  listAiHealthInsightsForDate: async () => [],
  upsertAiHealthInsight: async () => {},
}
vi.mock('@/lib/data', () => ({ getRepository: async () => repo }))

type Repo = Parameters<typeof import('@/lib/health/energy-balance-service').computeEnergyBalance>[0]

/** Every surface's budget for TODAY, keyed by surface. */
async function budgetsBySurface() {
  const { GET } = await import('@/app/api/nutrition/energy-balance/route')
  const res = await GET(new NextRequest(`http://localhost/api/nutrition/energy-balance?date=${TODAY}`))
  const payload = await res.json()

  const { buildChatTools } = await import('@/lib/ai-chat/tools')
  const tools = buildChatTools(repo as unknown as Repo, USER_ID, TZ, TODAY)
  const opts = { toolCallId: 't', messages: [] }
  const energy = await tools.getEnergyBalance.execute!({ date: null }, opts) as { dailyBudgetKcal: number; kcalLeftToHitTarget: number }
  const day = await tools.getNutritionDay.execute!({ date: null }, opts) as { targets: { calories: number }; remainingKcal: number }

  digestPrompt = ''
  const { POST } = await import('@/app/api/daily-digest/route')
  await POST(new Request('http://localhost/api/daily-digest', { method: 'POST', body: '{"force":true}' }))
  const digest = Number(/Nutrition today: \d+\/(\d+) kcal/.exec(digestPrompt)?.[1])

  // What every client surface computes from the payload (Nutrition, Home ×2, log-food sheet,
  // end-of-day review, Health goals, weekly chart).
  const client = budgetProvenance(payload.balance).total
  return {
    payload,
    budgets: {
      energyBalanceRoute: payload.balance.budgetKcal as number,
      clientSurfaces: client,
      coachGetEnergyBalance: energy.dailyBudgetKcal,
      coachGetNutritionDay: day.targets.calories,
      endOfDayDigest: digest,
    },
    remaining: {
      route: payload.balance.remainingKcal as number,
      coachEnergy: energy.kcalLeftToHitTarget,
      coachDay: day.remainingKcal,
    },
  }
}

beforeEach(() => {
  weightKg = 70.3
  history = []
  storedCalories = 1660
  targetWeightKg = 60
  vi.resetModules()
})

describe('#2071 — one calorie budget on every surface', () => {
  it('every surface returns the same number for the same day', async () => {
    const { budgets, remaining, payload } = await budgetsBySurface()
    const values = Object.values(budgets)
    expect(values.every(v => Number.isFinite(v))).toBe(true)
    expect(new Set(values).size).toBe(1)
    // …and the "left" figure on every surface is that budget minus the 900 eaten.
    expect(new Set(Object.values(remaining))).toEqual(new Set([budgets.clientSurfaces - 900]))
    // It is the shared function's number for the payload's own terms.
    const b = payload.balance
    expect(budgets.clientSurfaces).toBe(calorieBudget({
      rmrKcal: b.restingRateKcal, deficitKcal: b.deficitKcal, movementKcal: b.activeKcal,
      stepCreditKcal: b.stepCreditKcal,
    }).totalKcal)
    // (a) the energy model's own step credit is in it, never zero for a complete profile.
    expect(b.stepCreditKcal).toBeGreaterThan(0)
  })

  it("builds the deficit from the goal and today's weight", async () => {
    const { payload } = await budgetsBySurface()
    expect(payload.balance.deficitKcal).toBe(Math.round(goalDeficitKcal({
      goal: 'recomp', currentWeightKg: 70.3, targetWeightKg: 60,
    })))
    expect(payload.balance.deficitKcal).toBe(232)
    expect(payload.balance.targetNetKcal).toBe(-232)
  })

  it('shrinks the deficit, and so raises the still-day budget share, as weight falls', async () => {
    const heavy = (await budgetsBySurface()).payload.balance.deficitKcal
    weightKg = 66
    vi.resetModules()
    const lighter = (await budgetsBySurface()).payload.balance.deficitKcal
    expect(lighter).toBeLessThan(heavy)
  })

  // Owner 2026-10-07 (b): the deficit reads the smoothed 30-day trend weight — the Body screen's
  // Weight Trend line — and falls back to the latest weigh-in only when there is no trend.
  it('builds the deficit from the 30-day trend weight, not a noisy last weigh-in', async () => {
    // A steady fall from 72 kg, then a light reading today (a water swing).
    history = [20, 15, 10, 5, 2].map((back, i) => ({ date: shiftDateStr(TODAY, -back), weightKg: 72 - i * 0.3 }))
    weightKg = 69.0
    const { payload, budgets } = await budgetsBySurface()
    const trend = computeTrendWeightKg([...history, { date: TODAY, weightKg }])!
    expect(trend).toBeGreaterThan(69.0)
    expect(payload.balance.deficitWeightSource).toBe('trend')
    expect(payload.balance.deficitWeightKg).toBe(Math.round(trend * 10) / 10)
    expect(payload.balance.deficitKcal).toBe(Math.round(goalDeficitKcal({
      goal: 'recomp', currentWeightKg: trend, targetWeightKg: 60,
    })))
    expect(payload.balance.deficitKcal).not.toBe(Math.round(goalDeficitKcal({
      goal: 'recomp', currentWeightKg: 69.0, targetWeightKg: 60,
    })))
    expect(new Set(Object.values(budgets)).size).toBe(1)
  })

  it('ignores weigh-ins older than the 30-day trend window', async () => {
    history = [
      { date: shiftDateStr(TODAY, -40), weightKg: 90 },
      { date: shiftDateStr(TODAY, -35), weightKg: 90 },
      { date: shiftDateStr(TODAY, -31), weightKg: 90 },
    ]
    const { payload } = await budgetsBySurface()
    expect(payload.balance.deficitWeightSource).toBe('latest')
    expect(payload.balance.deficitKcal).toBe(232)
  })

  it('falls back to the latest weigh-in when there is no trend yet', async () => {
    const { payload } = await budgetsBySurface()
    expect(payload.balance.deficitWeightSource).toBe('latest')
    expect(payload.balance.deficitWeightKg).toBe(70.3)
  })

  it('takes no deficit with no goal weight set', async () => {
    targetWeightKg = null
    const { payload } = await budgetsBySurface()
    expect(payload.balance.deficitKcal).toBe(0)
  })

  it('the typed calorie goal moves no surface', async () => {
    const before = (await budgetsBySurface()).budgets
    storedCalories = 2400
    vi.resetModules()
    const after = (await budgetsBySurface()).budgets
    expect(after).toEqual(before)
    expect(Object.values(before)).not.toContain(1660)
    expect(Object.values(after)).not.toContain(2400)
  })
})
