/**
 * PS-39 — the nutrition goal → target → adherence chain: `nutrition/targets`,
 * `nutrition/adherence`, `nutrition/weekly-summary`, `nutrition-goals/[id]` and
 * `nutrition-goals/touch-review`.
 *
 * Batched because they are one loop rather than five endpoints: a recommendation is reviewed,
 * accepting it writes the targets, and adherence is how you find out whether the targets were
 * livable. Each carries a decision the response shape hides:
 *
 *   · **Saving a calorie target mirrors it into the denormalised `users.calorie_goal`** the Health
 *     tab and Home tiles read — converted back to the user's chosen daily/weekly unit, so the
 *     mirror never flips their display preference or writes a daily number into a weekly field.
 *   · **A `null` calorie target means "leave it alone", not "clear it"** — it reaches the upsert as
 *     `undefined` and skips the mirror entirely, which is why the two can never disagree.
 *   · **Zero required meal types is no signal, not zero adherence** — the ratio is `null`, because
 *     a user who configured no required meals has not failed to log them.
 *   · **A recommendation that is not the caller's answers 404**, and the review timestamp is only
 *     touched when a status actually changed.
 *   · **Both windows are built with `shiftDateStr`**, never the banned `Date.now() − N×86400000`
 *     offset, which straddles two local days.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toAestDay, todayInTz } from '@trainingai/shared/date-utils'

type Row = Record<string, unknown>
type LoggedDay = { date: string; requiredMealTypesLogged: number }

const getNutritionTargets = vi.fn(async (_u: string) => null as Row | null)
const upsertNutritionTargets = vi.fn(async (_u: string, d: Row) => ({ id: 't-1', ...d }) as Row)
const getUserGoals = vi.fn(async (_u: string) => ({ calorieGoalType: 'daily' }) as Row)
const updateUserGoals = vi.fn(async (_u: string, _g: Row) => undefined)
const getRequiredMealTypeLogDays = vi.fn(async (_u: string, _f: string, _t: string) =>
  ({ requiredMealTypeCount: 3, loggedByDay: [] as LoggedDay[] }))
const listFoodLogsSummary = vi.fn(async (_u: string, _f: string, _t: string) => [] as Row[])
const getGoalRecommendation = vi.fn(async (_u: string, _id: string) => ({ id: 'g-1' }) as Row | null)
const updateGoalRecommendationStatus = vi.fn(async (_u: string, _id: string, _s: string) => undefined)
const touchLastGoalReviewAt = vi.fn(async (_u: string) => undefined)

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the factory: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({
    getNutritionTargets, upsertNutritionTargets, getUserGoals, updateUserGoals,
    getRequiredMealTypeLogDays, listFoodLogsSummary,
    getGoalRecommendation, updateGoalRecommendationStatus, touchLastGoalReviewAt,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET as getTargets, PUT as putTargets } from '@/app/api/nutrition/targets/route'
import { GET as getAdherence } from '@/app/api/nutrition/adherence/route'
import { GET as getWeekly } from '@/app/api/nutrition/weekly-summary/route'
import { PATCH as patchGoal } from '@/app/api/nutrition-goals/[id]/route'
import { POST as postTouch } from '@/app/api/nutrition-goals/touch-review/route'

const GOAL = '00000000-0000-4000-8000-0000000000a1'

const put = (body: unknown) =>
  putTargets(new Request('http://localhost/api/nutrition/targets', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))

const patch = (id: string, body: unknown) =>
  patchGoal(new Request(`http://localhost/api/nutrition-goals/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) })

/** Days between two `YYYY-MM-DD` strings, so a window is measured rather than re-derived with the
 *  helper the route itself used — which would assert nothing. */
const spanDays = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000

let seq = 0
const freshUser = (over: { timezone?: string } = {}) => {
  sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane', ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  freshUser()
  getNutritionTargets.mockResolvedValue(null)
  upsertNutritionTargets.mockImplementation(async (_u: string, d: Row) => ({ id: 't-1', ...d }))
  getUserGoals.mockResolvedValue({ calorieGoalType: 'daily' })
  getRequiredMealTypeLogDays.mockResolvedValue({ requiredMealTypeCount: 3, loggedByDay: [] })
  listFoodLogsSummary.mockResolvedValue([])
  getGoalRecommendation.mockResolvedValue({ id: 'g-1' })
})

describe('/api/nutrition/targets', () => {
  it('refuses both verbs without a session', async () => {
    sessionUser = null
    expect((await getTargets()).status).toBe(401)
    expect((await put({ calories: 2000 })).status).toBe(401)
  })

  // An empty object, not `null`: a client calling `res.json()` on the no-targets case gets
  // something it can read fields off rather than a value it has to null-check first.
  it('answers an empty object when no targets are set, uncacheable', async () => {
    const res = await getTargets()
    expect(await res.json()).toEqual({})
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('bounds every macro and refuses a key it does not know', async () => {
    for (const bad of [
      { calories: -1 }, { calories: 20001 }, { proteinG: 2001 }, { carbsG: -5 },
      { fatG: 2001 }, { fiberG: 501 }, { userId: 'someone-else' }, { calories: 'lots' },
    ]) {
      expect((await put(bad)).status).toBe(400)
    }
    expect(upsertNutritionTargets).not.toHaveBeenCalled()
  })

  it('refuses an oversized body', async () => {
    expect((await put({ calories: 2000, proteinG: 150, fatG: 60, carbsG: 200, fiberG: 30, pad: 'x'.repeat(16 * 1024) })).status)
      .toBe(413)
    expect(upsertNutritionTargets).not.toHaveBeenCalled()
  })

  // The mirror is the whole reason this route is more than an upsert: the Health tab and Home tiles
  // read `users.calorie_goal`, so without it the two surfaces drift apart silently.
  it('mirrors the calorie target into the denormalised goal in the user\'s own unit', async () => {
    await put({ calories: 2000 })
    expect(updateUserGoals).toHaveBeenCalledWith(sessionUser!.id, { calorieGoal: 2000 })

    getUserGoals.mockResolvedValue({ calorieGoalType: 'weekly' })
    updateUserGoals.mockClear()
    await put({ calories: 2000 })
    // 14,000, not 2,000 — mirroring must never write a daily number into a weekly-typed field.
    expect(updateUserGoals).toHaveBeenCalledWith(sessionUser!.id, { calorieGoal: 14_000 })
  })

  // `null` is "leave it alone", which is why it can never desynchronise the mirror.
  it('treats a null calorie target as untouched rather than cleared', async () => {
    await put({ calories: null, proteinG: 150 })
    expect(upsertNutritionTargets).toHaveBeenCalledWith(sessionUser!.id, {
      calories: undefined, proteinG: 150, carbsG: undefined, fatG: undefined, fiberG: undefined,
    })
    expect(getUserGoals).not.toHaveBeenCalled()
    expect(updateUserGoals).not.toHaveBeenCalled()
  })

  it('saves the macros without a calorie target at all', async () => {
    const res = await put({ proteinG: 160, fatG: 70 })
    expect(res.status).toBe(200)
    expect(updateUserGoals).not.toHaveBeenCalled()
    expect((await res.json()).proteinG).toBe(160)
  })
})

describe('/api/nutrition/adherence', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await getAdherence()).status).toBe(401)
  })

  it('reads exactly twenty-eight local days ending today', async () => {
    await getAdherence()
    const [, from, to] = getRequiredMealTypeLogDays.mock.calls[0]
    expect(spanDays(from, to)).toBe(27)  // inclusive of both ends
  })

  // The 7-day figure is the MOST RECENT seven of the twenty-eight. A slice from the wrong end
  // reads the same shape and answers about four weeks ago.
  it('scores the last seven days separately from the last twenty-eight', async () => {
    const to = (await (async () => {
      await getAdherence()
      return getRequiredMealTypeLogDays.mock.calls[0][2]
    })())
    const day = (back: number) =>
      toAestDay(new Date(Date.parse(`${to}T00:00:00Z`) - back * 86_400_000), 'UTC')

    // Logged on the seven most recent days and nothing before them.
    getRequiredMealTypeLogDays.mockResolvedValue({
      requiredMealTypeCount: 3,
      loggedByDay: Array.from({ length: 7 }, (_, i) => ({ date: day(i), requiredMealTypesLogged: 3 })),
    })
    const body = await (await getAdherence()).json()
    expect(body.adherence7d).toBe(1)
    expect(body.adherence28d).toBeCloseTo(7 / 28)
  })

  // A user who configured no required meals has not failed to log them.
  it('answers no signal rather than zero when nothing is required', async () => {
    getRequiredMealTypeLogDays.mockResolvedValue({ requiredMealTypeCount: 0, loggedByDay: [] })
    const body = await (await getAdherence()).json()
    expect(body).toEqual({ requiredMealTypeCount: 0, adherence7d: null, adherence28d: null })
  })

  it('counts a day once however many meals it holds, and a short day not at all', async () => {
    const to = (await (async () => {
      await getAdherence()
      return getRequiredMealTypeLogDays.mock.calls[0][2]
    })())
    const day = (back: number) =>
      toAestDay(new Date(Date.parse(`${to}T00:00:00Z`) - back * 86_400_000), 'UTC')

    getRequiredMealTypeLogDays.mockResolvedValue({
      requiredMealTypeCount: 3,
      loggedByDay: [
        { date: day(0), requiredMealTypesLogged: 9 },  // over-logged, still one adherent day
        { date: day(1), requiredMealTypesLogged: 2 },  // short, not adherent
      ],
    })
    expect((await (await getAdherence()).json()).adherence7d).toBeCloseTo(1 / 7)
  })

  // Twenty-six hours apart, so their local days ALWAYS differ — a single zone only disagrees with
  // the default for part of the day, and an assertion that holds either way proves nothing.
  it('anchors the window to the caller\'s timezone, not the default', async () => {
    const endFor = async (timezone: string) => {
      getRequiredMealTypeLogDays.mockClear()
      freshUser({ timezone })
      await getAdherence()
      return getRequiredMealTypeLogDays.mock.calls[0][2]
    }
    const ahead = await endFor('Etc/GMT-14')
    const behind = await endFor('Etc/GMT+12')

    expect(ahead).toBe(todayInTz('Etc/GMT-14'))
    expect(behind).toBe(todayInTz('Etc/GMT+12'))
    expect(ahead).not.toBe(behind)
  })

  it('answers no-store', async () => {
    expect((await getAdherence()).headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('/api/nutrition/weekly-summary', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await getWeekly()).status).toBe(401)
  })

  it('reads exactly seven local days ending today, uncacheable', async () => {
    const res = await getWeekly()
    const [userId, from, to] = listFoodLogsSummary.mock.calls[0]
    expect(userId).toBe(sessionUser!.id)
    expect(spanDays(from, to)).toBe(6)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('anchors the week to the caller\'s timezone, not the default', async () => {
    const endFor = async (timezone: string) => {
      listFoodLogsSummary.mockClear()
      freshUser({ timezone })
      await getWeekly()
      return listFoodLogsSummary.mock.calls[0][2]
    }
    expect(await endFor('Etc/GMT-14')).toBe(todayInTz('Etc/GMT-14'))
    expect(await endFor('Etc/GMT+12')).toBe(todayInTz('Etc/GMT+12'))
    expect(todayInTz('Etc/GMT-14')).not.toBe(todayInTz('Etc/GMT+12'))
  })

  it('passes the rows through as the repository gave them', async () => {
    listFoodLogsSummary.mockResolvedValue([{ date: '2026-09-01', calories: 2100 }])
    expect(await (await getWeekly()).json()).toEqual([{ date: '2026-09-01', calories: 2100 }])
  })
})

describe('/api/nutrition-goals/[id]', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await patch(GOAL, { status: 'applied' })).status).toBe(401)
  })

  // Q-482: an id that is not a uuid is a malformed request, and answering 400 for it discloses
  // nothing — uuid syntax is public.
  it('refuses an id that is not a uuid before it reaches the repository', async () => {
    expect((await patch('not-a-uuid', { status: 'applied' })).status).toBe(400)
    expect(getGoalRecommendation).not.toHaveBeenCalled()
  })

  it('accepts only the two statuses that mean something', async () => {
    for (const body of [{}, { status: 'pending' }, { status: 'APPLIED' }, { status: true }, null]) {
      expect((await patch(GOAL, body)).status).toBe(400)
    }
    expect(updateGoalRecommendationStatus).not.toHaveBeenCalled()
    expect(touchLastGoalReviewAt).not.toHaveBeenCalled()
  })

  // The ownership check: the lookup is user-scoped, so another account's recommendation reads as
  // absent and answers exactly as one that never existed.
  it('answers 404 for a recommendation that is not the caller\'s, and writes nothing', async () => {
    getGoalRecommendation.mockResolvedValue(null)
    expect((await patch(GOAL, { status: 'applied' })).status).toBe(404)
    expect(updateGoalRecommendationStatus).not.toHaveBeenCalled()
    expect(touchLastGoalReviewAt).not.toHaveBeenCalled()
  })

  it('records the decision and stamps the review in one go', async () => {
    for (const status of ['applied', 'dismissed'] as const) {
      updateGoalRecommendationStatus.mockClear()
      touchLastGoalReviewAt.mockClear()
      getGoalRecommendation.mockClear()

      expect((await patch(GOAL, { status })).status).toBe(200)
      // The lookup IS the ownership check, so it is scoped to the caller or it checks nothing.
      expect(getGoalRecommendation).toHaveBeenCalledWith(sessionUser!.id, GOAL)
      expect(updateGoalRecommendationStatus).toHaveBeenCalledWith(sessionUser!.id, GOAL, status)
      expect(touchLastGoalReviewAt).toHaveBeenCalledWith(sessionUser!.id)
    }
  })

  it('refuses an oversized body', async () => {
    const res = await patch(GOAL, { status: 'applied', pad: 'x'.repeat(8 * 1024) })
    expect(res.status).toBe(413)
    expect(updateGoalRecommendationStatus).not.toHaveBeenCalled()
  })
})

describe('/api/nutrition-goals/touch-review', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await postTouch()).status).toBe(401)
  })

  // Reviewing the list without acting on any of it still counts as having reviewed it — which is
  // what stops the app re-prompting for a decision the owner has already made.
  it('stamps the review for the caller alone', async () => {
    expect((await postTouch()).status).toBe(200)
    expect(touchLastGoalReviewAt).toHaveBeenCalledWith(sessionUser!.id)
  })
})
