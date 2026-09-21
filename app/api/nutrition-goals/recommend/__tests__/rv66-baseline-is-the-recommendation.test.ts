// RV-66. The route quoted a fully computed baseline to the model and then asked the model to return
// its *own* calories/protein/carbs/fat/water/steps — which the sheet wrote into the user's goals on
// Apply. CLAUDE.md forbids that twice over: no LLM self-reported number may gate an automatic
// action or be shown to the user as fact.
//
// These tests are behavioural on purpose. The only test this route had was a source-grep over its
// own text, which is why deleting six fields from the response schema changed nothing about it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { calculateBaseline } from '@trainingai/shared/nutrition/goal-recommendation'

const USER_ID = '00000000-0000-4000-8000-000000000066'

// The owner's real profile on 2026-09-14, the day a recommendation was generated and applied.
let fitnessGoal = 'recomp'
const USER = {
  id: USER_ID, dateOfBirth: '1993-01-01', heightCm: 158, sex: 'male',
  activityLevel: 'moderate', timezone: 'Australia/Brisbane',
  get fitnessGoal() { return fitnessGoal },
}
const WEIGHT_KG = 70.35
const BODY_FAT_PCT = 25.7
const MEASURED_RMR = { rmrKcal: 1325, ffmKgAtTest: 51.5 }

/** What the model used to return that day, and what was stored and applied. */
const MODEL_NUMBERS = {
  recommendedStepsGoal: 5000, recommendedCalories: 1618, recommendedProteinG: 150,
  recommendedCarbsG: 131, recommendedFatG: 55, recommendedWaterMl: 2600,
}

let modelObject: Record<string, unknown> = {}
let created: Record<string, unknown> | null = null

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: USER })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('ai', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  generateObject: vi.fn(async () => ({ object: modelObject })),
}))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateObject: async (_m: unknown, run: () => Promise<unknown>) => run(),
}))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getUserById: async () => USER,
    getUserGoals: async () => ({ stepsGoal: 8000, stepsGoalType: 'manual', calorieGoal: 2000, calorieGoalType: 'manual', waterGoalMl: 2500, waterGoalType: 'manual' }),
    getNutritionTargets: async () => ({ calories: 2000, proteinG: 150, carbsG: 200, fatG: 60 }),
    listBodyMetrics: async () => [{ date: '2026-09-14', weightKg: WEIGHT_KG, bodyFatPct: BODY_FAT_PCT, bodyFatSource: 'scale' }],
    listSleepSessions: async () => [],
    listMoodLogs: async () => [],
    getWorkoutSessionsFrom: async () => [],
    listRecentPersonalRecords: async () => [],
    getActiveProgram: async () => null,
    listProgramPhases: async () => [],
    countSessionsSinceStart: async () => 0,
    getLatestMeasuredRmr: async () => MEASURED_RMR,
    getBodyFatCalibration: async () => null,
    getExerciseTypes: async () => ({}),
    createGoalRecommendation: async (_u: string, row: Record<string, unknown>) => { created = row; return { id: 'rec-1' } },
  }),
}))

import { POST } from '../route'

const baselineFor = (activityLevel: string, goal = fitnessGoal) => calculateBaseline({
  weightKg: WEIGHT_KG, heightCm: 158, ageYears: 33, sex: 'male',
  activityLevel: activityLevel as 'moderate', fitnessGoal: goal as 'recomp',
  bodyFatPct: BODY_FAT_PCT, measuredRmr: MEASURED_RMR,
})

const call = async () => {
  const res = await POST(new Request('http://t/api/nutrition-goals/recommend', { method: 'POST' }))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  created = null
  fitnessGoal = 'recomp'
  modelObject = { recommendedActivityLevel: null, reasoning: 'r', insights: 'i', dataQualityNote: '' }
})

describe('/api/nutrition-goals/recommend', () => {
  it('returns the computed baseline, not a number the model chose', async () => {
    const base = baselineFor('moderate')
    const { status, body } = await call()

    expect(status).toBe(200)
    // Four of the five pass through `clampRecommendation` untouched, so they are the baseline
    // exactly. Fat is the exception and is asserted separately below — the two formulas genuinely
    // disagree, which is a pre-existing defect rather than anything this change introduced.
    expect(body.recommended).toMatchObject({
      calories: base.calories,
      proteinG: base.proteinG,
      waterMl: base.waterMl,
      stepsGoal: base.stepsGoal,
    })
    // The figures that were actually shipped to the owner and applied, for contrast. If any of
    // these ever match again, the model is setting the numbers once more.
    expect(body.recommended.calories).not.toBe(MODEL_NUMBERS.recommendedCalories)
    expect(body.recommended.proteinG).not.toBe(MODEL_NUMBERS.recommendedProteinG)
    expect(body.recommended.stepsGoal).not.toBe(MODEL_NUMBERS.recommendedStepsGoal)
  })

  it('ignores numeric fields even when the model volunteers them', async () => {
    // The load-bearing case: a model that keeps emitting its old shape must not be able to reach
    // the response. Dropping the fields from the schema is what makes this true, and a schema is
    // exactly the kind of thing a later edit re-adds "for completeness".
    modelObject = { ...modelObject, ...MODEL_NUMBERS }
    const base = baselineFor('moderate')
    const { body } = await call()

    expect(body.recommended.stepsGoal).toBe(base.stepsGoal)
    expect(body.recommended.calories).toBe(base.calories)
    expect(body.recommended.proteinG).toBe(base.proteinG)
  })

  it('persists the baseline figures, since the sheet applies what was stored', async () => {
    const base = baselineFor('moderate')
    await call()

    expect(created).toMatchObject({
      recommendedCalories: base.calories,
      recommendedProteinG: base.proteinG,
      recommendedStepsGoal: base.stepsGoal,
    })
  })

  it('recomputes every figure from a suggested activity level, rather than taking the model\'s word for the result', async () => {
    // The one judgement the model still makes is a CATEGORY. The numbers that follow are the
    // formula's, evaluated on the new level — which is why `active` has to move steps to its own
    // table value rather than to anything the model says.
    modelObject = { ...modelObject, recommendedActivityLevel: 'active', ...MODEL_NUMBERS }
    const onActive = baselineFor('active')
    const onModerate = baselineFor('moderate')
    expect(onActive.stepsGoal).not.toBe(onModerate.stepsGoal)  // the fixture would be vacuous otherwise

    const { body } = await call()

    expect(body.recommended.activityLevel).toBe('active')
    expect(body.recommended.stepsGoal).toBe(onActive.stepsGoal)
    expect(body.recommended.waterMl).toBe(onActive.waterMl)
  })

  // This is the case that makes keeping `clampRecommendation` load-bearing rather than tidy, and it
  // is asserted rather than argued: `CALORIE_ADJUSTMENT_BY_GOAL` subtracts 500 for `lose_weight`,
  // and `bmr × 1.2 − 500` is below `bmr` for any BMR under 2,500. Without the floor a cutting user
  // is shown a sub-resting-rate calorie target — computed honestly, and still wrong to display.
  it('floors a cutting baseline that falls under the resting rate, and says it did', async () => {
    fitnessGoal = 'lose_weight'
    const base = baselineFor('moderate', 'lose_weight')
    expect(base.calories).toBeLessThan(base.bmr)  // the fixture would be vacuous otherwise

    const { body } = await call()

    expect(body.recommended.calories).toBe(Math.max(1200, base.bmr))
    expect(body.dataQualityNote).toContain('safe minimum')
  })

  // ⚠ Pinned as CURRENT BEHAVIOUR, not endorsed — filed as LA-125.
  //
  // `calculateBaseline` sets fat at 25% of calories; `clampRecommendation` floors it at 0.6 g/kg of
  // body weight. For this profile those are 39 g and 42 g, so the clamp raises fat and carbs fall
  // out of the remainder at 143 instead of the baseline's 150. The recommendation is therefore "the
  // baseline, made safe" rather than the baseline byte-for-byte, and a surface reading
  // `calculateBaseline` directly will not match this one.
  //
  // The clamp cannot simply be dropped to close the gap: `CALORIE_ADJUSTMENT_BY_GOAL` subtracts 500
  // for `lose_weight`, and `bmr × 1.2 − 500 < bmr` for any BMR under 2,500 — which is most people —
  // so its calorie floor is load-bearing for every cutting user.
  it('applies the clamp floors to the baseline, and derives carbs from what is left', async () => {
    const base = baselineFor('moderate')
    const fatFloor = Math.round(0.6 * WEIGHT_KG)
    expect(base.fatG).toBeLessThan(fatFloor)  // the disagreement this test exists to pin

    const { body } = await call()

    expect(body.recommended.fatG).toBe(fatFloor)
    // Carbs are the remainder of the CLAMPED figures, never a value anyone chose.
    const expectedCarbs = Math.round((base.calories - body.recommended.proteinG * 4 - fatFloor * 9) / 4)
    expect(body.recommended.carbsG).toBe(expectedCarbs)
    expect(body.recommended.carbsG).not.toBe(MODEL_NUMBERS.recommendedCarbsG)
  })
})
