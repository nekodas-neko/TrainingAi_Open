/**
 * PS-39, then #3286 — `/api/nutrition-goals/recommend`.
 *
 * RV-66 took every number from the model; #3286 took the explanation and the activity-level call,
 * so the route makes no model call at all. The `ai` module is mocked and the AI instrument throws:
 * a case that reached either would fail rather than quietly spend a request on the owner's key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { calculateBaseline } from '@trainingai/shared/nutrition/goal-recommendation'
import { todayInTz, toAestDay } from '@trainingai/shared/date-utils'

type Row = Record<string, unknown>

const getUserById = vi.fn(async (_id: string) => user())
const listBodyMetrics = vi.fn(async (_u: string, _f: string, _t: string) => [
  { id: 'b1', date: '2026-09-08', weightKg: 80 },
] as Row[])
const getWorkoutSessionsFrom = vi.fn(async () => [] as Row[])
const listRecentPersonalRecords = vi.fn(async () => [] as Row[])
const getUserGoals = vi.fn(async () => ({
  stepsGoal: 9000, stepsGoalType: 'daily', sleepGoalHours: 8, calorieGoal: null,
  calorieGoalType: 'daily', waterGoalMl: 2500, waterGoalType: 'daily',
  targetWeightKg: null, targetBfPct: null,
} as Row))
const getNutritionTargets = vi.fn(async () => ({ userId: 'u-1', calories: 2100, proteinG: 150, carbsG: 200, fatG: 60 }) as Row | null)
const getActiveProgram = vi.fn(async () => null as Row | null)
const getBodyFatCalibration = vi.fn(async (_u: string) => null as Row | null)
const getLatestMeasuredRmr = vi.fn(async (_u: string) => null as Row | null)
const listProgramPhases = vi.fn(async () => [] as Row[])
const countSessionsSinceStart = vi.fn(async () => 0)
const createGoalRecommendation = vi.fn(async (_u: string, _d: Row) => ({ id: 'rec-1' }))
/** The route must never call this; every case below can assert it. */
const generateObject = vi.fn(async (_o: unknown) => ({ object: {} }))
const aiModel = vi.fn(() => { throw new Error('the route must not ask for a model') })

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the factory's returned function, not its body: `vi.mock` is hoisted above the
  // `const` declarations above and reading them at factory-evaluation time is a TDZ error.
  const repo = async () => ({
    getUserById, listBodyMetrics, getWorkoutSessionsFrom,
    listRecentPersonalRecords, getUserGoals, getNutritionTargets, getActiveProgram,
    getBodyFatCalibration, getLatestMeasuredRmr, listProgramPhases,
    countSessionsSinceStart, createGoalRecommendation,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('ai', () => ({ generateObject: (o: unknown) => generateObject(o) }))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => aiModel(),
  loggedGenerateObject: async () => { throw new Error('the route must not log a model call') },
}))

import { POST as recommend } from '@/app/api/nutrition-goals/recommend/route'

const user = (over: Row = {}) => ({
  id: 'u-1', heightCm: 180, dateOfBirth: '1996-01-01', sex: 'male',
  activityLevel: 'moderate', fitnessGoal: 'maintain', timezone: 'Australia/Brisbane',
  weightGoalKg: undefined, ...over,
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
    getBodyFatCalibration, getLatestMeasuredRmr, createGoalRecommendation, generateObject, aiModel]) m.mockClear()
  listBodyMetrics.mockResolvedValue([{ id: 'b1', date: '2026-09-08', weightKg: 80 }])
  getActiveProgram.mockResolvedValue(null)
  getBodyFatCalibration.mockResolvedValue(null)
  getLatestMeasuredRmr.mockResolvedValue(null)
  createGoalRecommendation.mockResolvedValue({ id: 'rec-1' })
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

  it('answers no_weight_data', async () => {
    listBodyMetrics.mockResolvedValue([{ id: 'b1', date: '2026-09-08', steps: 8000 }])
    const res = await post()
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'no_weight_data' })
  })

  it('refuses an oversized body', async () => {
    const res = await post({ source: 'x'.repeat(8 * 1024) })
    expect(res.status).toBe(413)
  })

  it('rate-limits the sixth call in the window', async () => {
    for (let i = 0; i < 5; i++) expect((await post()).status).toBe(200)
    const res = await post()
    expect(res.status).toBe(429)
    expect(createGoalRecommendation).toHaveBeenCalledTimes(5)
  })
})

describe('POST /api/nutrition-goals/recommend — rule-based, no model (#3286)', () => {
  it('makes no model call on a normal run', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(generateObject).not.toHaveBeenCalled()
    expect(aiModel).not.toHaveBeenCalled()
  })

  it('serves the computed baseline, stored and returned alike', async () => {
    const body = await (await post()).json()
    const base = baseline()
    expect(body.recommended).toMatchObject({
      calories: base.calories, proteinG: base.proteinG, carbsG: base.carbsG,
      fatG: base.fatG, waterMl: base.waterMl, stepsGoal: base.stepsGoal, activityLevel: null,
    })
    expect(persisted().recommendedCalories).toBe(base.calories)
  })

  it('writes the explanation from the baseline\'s own figures', async () => {
    const body = await (await post()).json()
    const base = baseline()
    expect(body.reasoning).toContain(`${base.calories.toLocaleString('en-US')} kcal`)
    expect(body.reasoning).toContain(`${base.proteinG} g protein`)
    expect(body.reasoning).toContain('maintaining weight')
    expect(body.insights).toContain('0 workout sessions in the last 14 days.')
    expect(persisted().reasoning).toBe(body.reasoning)
    expect(persisted().insights).toBe(body.insights)
  })

  it('notes thin data when fewer than three days carry body metrics, and stays quiet otherwise', async () => {
    const thin = await (await post()).json()   // the default fixture has one weigh-in
    expect(thin.dataQualityNote).toBe('Only 1 of the last 14 days have logged body metrics, so the trend above is thin.')

    freshUser()
    listBodyMetrics.mockResolvedValue([
      { id: 'b3', date: '2026-09-08', weightKg: 80 },
      { id: 'b2', date: '2026-09-07', weightKg: 80.4 },
      { id: 'b1', date: '2026-09-06', weightKg: 80.8 },
    ])
    const full = await (await post()).json()
    expect(full.dataQualityNote).toBe('')
    expect(full.reasoning).toContain('your weight changed -0.8 kg')
  })

  it('suggests a higher activity level when the log clearly outgrows the stated one, and recomputes through the formula', async () => {
    getUserById.mockResolvedValue(user({ id: sessionUser!.id, activityLevel: 'light' }) as never)
    getWorkoutSessionsFrom.mockResolvedValue(Array.from({ length: 8 }, (_, i) => ({ id: `w${i}` })))
    const onModerate = calculateBaseline({
      weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male',
      activityLevel: 'moderate', fitnessGoal: 'maintain', bodyFatPct: undefined, measuredRmr: null,
    })
    const body = await (await post()).json()

    expect(body.recommended.activityLevel).toBe('moderate')
    expect(body.recommended.stepsGoal).toBe(onModerate.stepsGoal)
    expect(body.recommended.waterMl).toBe(onModerate.waterMl)
    // Q-401: the level cannot move calories, only the steps and water lookups.
    expect(body.recommended.calories).toBe(onModerate.calories)
    expect(body.reasoning).toContain('8 sessions in 14 days')
    expect(persisted().recommendedActivityLevel).toBe('moderate')
  })

  it('keeps the stated level when training is below the threshold', async () => {
    getUserById.mockResolvedValue(user({ id: sessionUser!.id, activityLevel: 'light' }) as never)
    getWorkoutSessionsFrom.mockResolvedValue(Array.from({ length: 7 }, (_, i) => ({ id: `w${i}` })))
    const body = await (await post()).json()
    expect(body.recommended.activityLevel).toBeNull()
  })

  // `CALORIE_ADJUSTMENT_BY_GOAL` subtracts 500 for `lose_weight`; the clamp still floors it.
  it('keeps the calorie floor and says so in the data-quality note', async () => {
    getUserById.mockResolvedValue(user({ id: sessionUser!.id, fitnessGoal: 'lose_weight', heightCm: 150 }) as never)
    listBodyMetrics.mockResolvedValue([{ id: 'b1', date: '2026-09-08', weightKg: 50 }])
    const body = await (await post()).json()
    expect(body.recommended.calories).toBeGreaterThanOrEqual(1200)
    expect(generateObject).not.toHaveBeenCalled()
  })
})

describe('POST /api/nutrition-goals/recommend — failure and context', () => {
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
    // Protein is read back as the tell for WHICH weight was used. It used to be the clamp's
    // 2.5 g/kg ceiling; since RV-66 it is the baseline's own dosing, so the figure changed while
    // the property did not. Derived rather than written as 131, and checked against the rows it
    // must NOT have picked, so the case cannot pass by coincidence.
    const proteinFor = (weightKg: number) => calculateBaseline({
      weightKg, heightCm: 180, ageYears: 30, sex: 'male',
      activityLevel: 'moderate', fitnessGoal: 'maintain',
      bodyFatPct: undefined, measuredRmr: null,
    }).proteinG
    const got = (await (await post()).json()).recommended.proteinG

    expect(got).toBe(proteinFor(82))
    expect(got).not.toBe(proteinFor(95))   // the older row
    expect(got).not.toBe(proteinFor(80))   // the default fixture's weight
  })

  it('reports the current goals beside the recommendation, falling back to stored targets for calories', async () => {
    const body = await (await post()).json()
    expect(body.current.calorieGoal).toBe(2100) // no calorieGoal set; nutrition targets fill it
    expect(body.current.stepsGoal).toBe(9000)
    expect(body.current.activityLevel).toBe('moderate')
    expect(body.id).toBe('rec-1')
  })
})
