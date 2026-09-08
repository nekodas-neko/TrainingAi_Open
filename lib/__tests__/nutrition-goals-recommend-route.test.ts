/**
 * PS-39 — `/api/nutrition-goals/recommend`, one of the routes #956 found was believed tested and
 * was not (the scan matched a substring, and nothing imported this route).
 *
 * The property worth pinning is the one the AI rules state and this route is the sharpest case of:
 * **no number the model reports may reach the user as fact.** Everything it returns passes through
 * `clampRecommendation` first, carbohydrate is not even read from it, and every clamp says so in
 * `dataQualityNote` rather than silently rewriting the answer. A model that returns 400 kcal must
 * not produce a 400 kcal goal, and a route that stopped clamping would look completely healthy from
 * the outside — the response shape is identical either way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { calculateBaseline } from '@trainingai/shared/nutrition/goal-recommendation'
import { todayInTz, toAestDay } from '@trainingai/shared/date-utils'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => user())
const listBodyMetrics = vi.fn(async (_u: string, _f: string, _t: string) => [
  { id: 'b1', date: '2026-09-08', weightKg: 80 },
] as Row[])
const listSleepSessions = vi.fn(async () => [] as Row[])
const listMoodLogs = vi.fn(async () => [] as Row[])
const getWorkoutSessionsFrom = vi.fn(async () => [] as Row[])
const listRecentPersonalRecords = vi.fn(async () => [] as Row[])
const getUserGoals = vi.fn(async () => ({
  stepsGoal: 9000, stepsGoalType: 'daily', sleepGoalHours: 8, calorieGoal: null,
  calorieGoalType: 'daily', waterGoalMl: 2500, waterGoalType: 'daily',
  targetWeightKg: null, targetBfPct: null,
} as Row))
const getNutritionTargets = vi.fn(async () => ({ userId: 'u-1', calories: 2100, proteinG: 150, carbsG: 200, fatG: 60 }) as Row | null)
const getActiveProgram = vi.fn(async () => null as Row | null)
const getExerciseTypes = vi.fn(async (_n: string[]) => ({}) as Record<string, string>)
const getBodyFatCalibration = vi.fn(async (_u: string) => null as Row | null)
const getLatestMeasuredRmr = vi.fn(async (_u: string) => null as Row | null)
const listProgramPhases = vi.fn(async () => [] as Row[])
const countSessionsSinceStart = vi.fn(async () => 0)
const createGoalRecommendation = vi.fn(async (_u: string, _d: Row) => ({ id: 'rec-1' }))
/** Loosely typed on purpose: the model returns arbitrary JSON and the schema is what narrows it,
 *  so a case handing back an out-of-range number has to be expressible here. */
const generateObject = vi.fn(async (_o: unknown) => ({ object: aiObject() as Record<string, unknown> }))

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the factory's returned function, not its body: `vi.mock` is hoisted above the
  // `const` declarations above and reading them at factory-evaluation time is a TDZ error.
  const repo = async () => ({
    getUserById, listBodyMetrics, listSleepSessions, listMoodLogs, getWorkoutSessionsFrom,
    listRecentPersonalRecords, getUserGoals, getNutritionTargets, getActiveProgram,
    getExerciseTypes, getBodyFatCalibration, getLatestMeasuredRmr, listProgramPhases,
    countSessionsSinceStart, createGoalRecommendation,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('ai', () => ({ generateObject: (o: unknown) => generateObject(o) }))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateObject: async (_m: unknown, run: () => Promise<unknown>) => run(),
}))

import { POST as recommend } from '@/app/api/nutrition-goals/recommend/route'

const user = (over: Row = {}) => ({
  id: 'u-1', heightCm: 180, dateOfBirth: '1996-01-01', sex: 'male',
  activityLevel: 'moderate', fitnessGoal: 'maintain', timezone: 'Australia/Brisbane',
  weightGoalKg: undefined, ...over,
})

/** A model answer that needs no clamping, so a case can move exactly one number. */
const aiObject = (over: Row = {}) => ({
  recommendedStepsGoal: 10000, recommendedCalories: 2100, recommendedProteinG: 150,
  recommendedCarbsG: 200, recommendedFatG: 60, recommendedWaterMl: 2800,
  recommendedActivityLevel: null, reasoning: 'Hold steady.', insights: 'Sleep is stable.',
  dataQualityNote: '', ...over,
})

/** The baseline the route computes for the default fixture — imported, not re-derived, because
 *  `calculateBaseline` is the one place that formula lives. */
const baseline = () => calculateBaseline({
  weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male',
  activityLevel: 'moderate', fitnessGoal: 'maintain',
  bodyFatPct: undefined, measuredRmr: null,
})

const post = (body?: unknown, headers: Record<string, string> = {}) =>
  recommend(new Request('http://localhost/api/nutrition-goals/recommend', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never)

/** A fresh user per case — the route allows 5 calls a minute and cases would throttle each other. */
let seq = 0
const freshUser = (over: { timezone?: string } = {}) => {
  sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane', ...over }
  getUserById.mockResolvedValue(user({ id: sessionUser.id, timezone: sessionUser.timezone }))
}

beforeEach(() => {
  for (const m of [getUserById, listBodyMetrics, getUserGoals, getNutritionTargets, getActiveProgram,
    getBodyFatCalibration, getLatestMeasuredRmr, createGoalRecommendation, generateObject]) m.mockClear()
  listBodyMetrics.mockResolvedValue([{ id: 'b1', date: '2026-09-08', weightKg: 80 }])
  getActiveProgram.mockResolvedValue(null)
  getBodyFatCalibration.mockResolvedValue(null)
  getLatestMeasuredRmr.mockResolvedValue(null)
  createGoalRecommendation.mockResolvedValue({ id: 'rec-1' })
  generateObject.mockResolvedValue({ object: aiObject() })
  freshUser()
})

const persisted = () => createGoalRecommendation.mock.calls[0][1] as Row

describe('POST /api/nutrition-goals/recommend — refusals', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await post()).status).toBe(401)
  })

  it('refuses when the session names a user that no longer exists', async () => {
    getUserById.mockResolvedValue(null as never)
    expect((await post()).status).toBe(401)
  })

  it('names every missing profile field rather than failing on the first', async () => {
    getUserById.mockResolvedValue(user({ heightCm: null, sex: null, fitnessGoal: null }) as never)
    const res = await post()
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('profile_incomplete')
    expect(body.missing.sort()).toEqual(['fitnessGoal', 'heightCm', 'sex'])
  })

  it('treats an unparseable date of birth as a missing one, not a crash', async () => {
    // It passes the `!user.dateOfBirth` gate and only fails later, in `ageFromDob`.
    getUserById.mockResolvedValue(user({ dateOfBirth: 'sometime in the 90s' }) as never)
    const res = await post()
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'profile_incomplete', missing: ['dateOfBirth'] })
  })

  it('answers no_weight_data without spending a model call', async () => {
    listBodyMetrics.mockResolvedValue([{ id: 'b1', date: '2026-09-08', steps: 8000 }])
    const res = await post()
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'no_weight_data' })
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('refuses an oversized body', async () => {
    const res = await post({ source: 'x'.repeat(8 * 1024) })
    expect(res.status).toBe(413)
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('rate-limits the sixth call in the window', async () => {
    for (let i = 0; i < 5; i++) expect((await post()).status).toBe(200)
    const res = await post()
    expect(res.status).toBe(429)
    expect(generateObject).toHaveBeenCalledTimes(5)
  })
})

describe('POST /api/nutrition-goals/recommend — the model never sets a number', () => {
  it('raises a starvation calorie target to the safe minimum and says so', async () => {
    generateObject.mockResolvedValue({ object: aiObject({ recommendedCalories: 400 }) })
    const res = await post()
    const body = await res.json()
    const min = Math.max(1200, baseline().bmr)
    expect(body.recommended.calories).toBe(min)
    expect(body.dataQualityNote).toContain(`safe minimum (${min})`)
    // The stored row carries the clamped number too — a client is not the only reader.
    expect(persisted().recommendedCalories).toBe(min)
  })

  it('lowers a calorie target above the ceiling to the safe maximum and says so', async () => {
    generateObject.mockResolvedValue({ object: aiObject({ recommendedCalories: 9000 }) })
    const body = await (await post()).json()
    const max = Math.round(baseline().calories * 1.2)
    expect(body.recommended.calories).toBe(max)
    expect(body.dataQualityNote).toContain(`safe maximum (${max})`)
  })

  it('bounds protein by body weight in both directions', async () => {
    generateObject.mockResolvedValue({ object: aiObject({ recommendedProteinG: 12 }) })
    expect((await (await post()).json()).recommended.proteinG).toBe(80) // 1.0 g/kg × 80 kg

    freshUser()
    generateObject.mockResolvedValue({ object: aiObject({ recommendedProteinG: 900 }) })
    expect((await (await post()).json()).recommended.proteinG).toBe(200) // 2.5 g/kg × 80 kg
  })

  it('bounds water and steps to their fixed floors and ceilings', async () => {
    generateObject.mockResolvedValue({ object: aiObject({ recommendedWaterMl: 200, recommendedStepsGoal: 90000 }) })
    const body = await (await post()).json()
    expect(body.recommended.waterMl).toBe(1500)
    expect(body.recommended.stepsGoal).toBe(20000)
    expect(body.dataQualityNote).toContain('Water adjusted to minimum (1500ml).')
    expect(body.dataQualityNote).toContain('Steps goal adjusted to maximum (20000).')
  })

  it('never uses the carbohydrate figure the model returned — carbs are the calorie remainder', async () => {
    generateObject.mockResolvedValue({ object: aiObject({ recommendedCarbsG: 5 }) })
    const body = await (await post()).json()
    const { calories, proteinG, fatG } = body.recommended
    expect(body.recommended.carbsG).toBe(Math.round((calories - proteinG * 4 - fatG * 9) / 4))
    expect(body.recommended.carbsG).not.toBe(5)
  })

  it('keeps the model prose but prefixes the clamp note to its own data-quality line', async () => {
    generateObject.mockResolvedValue({ object: aiObject({ recommendedCalories: 9000, dataQualityNote: 'Only two days logged.' }) })
    const body = await (await post()).json()
    expect(body.dataQualityNote).toMatch(/^Only two days logged\. Calories adjusted/)
    expect(body.reasoning).toBe('Hold steady.')
  })

  it('leaves an in-range answer alone and notes nothing', async () => {
    const body = await (await post()).json()
    expect(body.recommended.calories).toBe(2100)
    expect(body.recommended.proteinG).toBe(150)
    expect(body.dataQualityNote).toBe('')
  })

  it('does not let a suggested activity level move the calorie target (Q-401: one TDEE model)', async () => {
    // The route re-computes the baseline for a suggested level, but since Q-401 the baseline is
    // BMR × sedentary everywhere and activity is only ever ADDED elsewhere — so the level the model
    // suggests is passed through as a suggestion and changes no number here.
    generateObject.mockResolvedValue({ object: aiObject({ recommendedActivityLevel: 'extra_active', recommendedCalories: 9000 }) })
    const body = await (await post()).json()
    expect(body.recommended.calories).toBe(Math.round(baseline().calories * 1.2))
    expect(body.recommended.activityLevel).toBe('extra_active')
    expect(persisted().recommendedActivityLevel).toBe('extra_active')
  })
})

describe('POST /api/nutrition-goals/recommend — failure and context', () => {
  it('answers recommendation_failed rather than a raw 500 when the model throws, and stores nothing', async () => {
    generateObject.mockRejectedValue(new Error('model down'))
    const res = await post()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'recommendation_failed' })
    expect(createGoalRecommendation).not.toHaveBeenCalled()
  })

  it('answers recommendation_failed when the write fails, so no half-stored recommendation is claimed', async () => {
    createGoalRecommendation.mockRejectedValue(new Error('deadlock'))
    const res = await post()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'recommendation_failed' })
  })

  it('survives a body-fat calibration lookup that fails', async () => {
    getBodyFatCalibration.mockRejectedValue(new Error('table missing'))
    expect((await post()).status).toBe(200)
  })

  it('records a scheduled run as scheduled and anything else as on-demand', async () => {
    await post({ source: 'scheduled' })
    expect(persisted().source).toBe('scheduled')

    freshUser(); createGoalRecommendation.mockClear()
    await post({ source: 'whatever' })
    expect(persisted().source).toBe('on_demand')

    freshUser(); createGoalRecommendation.mockClear()
    await post() // no body at all — the marker is optional
    expect(persisted().source).toBe('on_demand')
  })

  it('keys the 14-day window to the user timezone, not the server one', async () => {
    // Two fixed-offset zones 26 hours apart, so their local dates differ whatever the clock says —
    // a pair that only usually differs turns this into a test that only usually tests anything.
    const windowStartFor = async (timezone: string) => {
      freshUser({ timezone }); listBodyMetrics.mockClear()
      await post()
      return listBodyMetrics.mock.calls[0][1]
    }
    const ahead = await windowStartFor('Etc/GMT-14')
    const behind = await windowStartFor('Etc/GMT+12')
    expect(ahead).not.toBe(behind)
    for (const [tz, got] of [['Etc/GMT-14', ahead], ['Etc/GMT+12', behind]] as const) {
      const [y, m, d] = todayInTz(tz).split('-').map(Number)
      const expected = toAestDay(new Date(Date.UTC(y, m - 1, d) - 14 * 86_400_000), 'UTC')
      expect(got).toBe(expected)
    }
  })

  it('takes the most recent logged weight, skipping newer rows that carry none', async () => {
    listBodyMetrics.mockResolvedValue([
      { id: 'b3', date: '2026-09-08', steps: 8000 },     // newest, no weight
      { id: 'b2', date: '2026-09-06', weightKg: 82 },
      { id: 'b1', date: '2026-09-01', weightKg: 95 },
    ])
    generateObject.mockResolvedValue({ object: aiObject({ recommendedProteinG: 900 }) })
    expect((await (await post()).json()).recommended.proteinG).toBe(205) // 2.5 g/kg × 82 kg
  })

  it('reports the current goals beside the recommendation, falling back to stored targets for calories', async () => {
    const body = await (await post()).json()
    expect(body.current.calorieGoal).toBe(2100) // no calorieGoal set; nutrition targets fill it
    expect(body.current.stepsGoal).toBe(9000)
    expect(body.current.activityLevel).toBe('moderate')
    expect(body.id).toBe('rec-1')
  })
})
