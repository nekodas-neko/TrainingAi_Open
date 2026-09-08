/**
 * PS-39 — a meal plan's lifecycle: `nutrition/meal-plans` (list and create),
 * `…/meal-plans/[id]` (read, edit, delete), `…/[id]/review` and `…/meals/[mealId]`.
 *
 * Batched because they are one object's life, and each holds a decision the response shape hides:
 *
 *   · **Someone else's plan is a 404, never a 403.** The route says why: a 403 makes an id that
 *     exists distinguishable from one that does not, which turns the id space into an enumeration
 *     oracle. Every one of the four answers 404 for a plan that is not the caller's.
 *   · **Activation is transactional, not a settable field.** `isActive` leaves the whitelisted
 *     field patch and goes through `setMealPlanActive`, which clears the previously active plan —
 *     writing it as a column would leave two plans active.
 *   · **`scaleToTarget` is opt-in, and scales against the meal's OWN stored targets.** A rename
 *     PATCHes the same route, and a rename must not silently reprice a meal or spend an AI call;
 *     the targets are re-read rather than taken from the request, so a client sending wrong ones
 *     cannot reprice the meal either.
 *   · **A plan's variants are `all` alone or the `training`+`rest` pair — never a partial split.**
 *
 * `scaleWithTopUp` is mocked: it is the AI top-up path and has its own tests. Every schema is real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const listMealPlans = vi.fn(async (_u: string) => [] as Row[])
const createMealPlan = vi.fn(async (_u: string, _d: Row) => ({ id: 'plan-1' }) as Row)
const getMealPlan = vi.fn(async (_id: string, _u: string) => ({ id: 'plan-1', name: 'Cut' }) as Row | null)
const updateMealPlan = vi.fn(async (_id: string, _u: string, _f: Row) => ({ id: 'plan-1' }) as Row | null)
const setMealPlanActive = vi.fn(async (_id: string, _u: string, _a: boolean) => ({ id: 'plan-1', isActive: true }) as Row | null)
const deleteMealPlan = vi.fn(async (_id: string, _u: string) => true)
const markMealPlanReviewed = vi.fn(async (_id: string, _u: string) => true)
const getMealPlanMeal = vi.fn(async (_id: string, _u: string) => meal() as Row | null)
const updateMealPlanMeal = vi.fn(async (_id: string, _u: string, _i: Row) => ({ id: 'meal-1' }) as Row | null)
const listUserDietaryRestrictions = vi.fn(async (_u: string) =>
  [] as Array<{ label: string; severity: string }>)
const scaleWithTopUp = vi.fn(async (ing: unknown[], _t: unknown, _o: unknown) => ing)

let sessionUser: { id: string } | null = { id: 'u-1' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the returned function: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({
    listMealPlans, createMealPlan, getMealPlan, updateMealPlan, setMealPlanActive,
    deleteMealPlan, markMealPlanReviewed, getMealPlanMeal, updateMealPlanMeal,
    listUserDietaryRestrictions,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@/lib/nutrition/meal-top-up', () => ({
  scaleWithTopUp: (i: unknown[], t: unknown, o: unknown) => scaleWithTopUp(i, t, o),
}))

import { GET as listPlans, POST as createPlan } from '@/app/api/nutrition/meal-plans/route'
import { GET as readPlan, PATCH as editPlan, DELETE as removePlan } from '@/app/api/nutrition/meal-plans/[id]/route'
import { POST as reviewPlan } from '@/app/api/nutrition/meal-plans/[id]/review/route'
import { PATCH as editMeal } from '@/app/api/nutrition/meal-plans/meals/[mealId]/route'

const PLAN = '00000000-0000-4000-8000-0000000000c1'
const MEAL = '00000000-0000-4000-8000-0000000000d1'

const ingredient = (over: Row = {}) => ({
  name: 'Chicken breast', weightG: 200, caloriesPer100g: 165,
  proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, ...over,
})

const meal = (over: Row = {}) => ({
  id: MEAL, name: 'Lunch', position: 0,
  targetCalories: 700, targetProteinG: 50, targetCarbsG: 60, targetFatG: 20, ...over,
})

const planMeal = (over: Row = {}) => ({
  position: 0, name: 'Lunch', targetCalories: 700,
  targetProteinG: 50, targetCarbsG: 60, targetFatG: 20, ...over,
})

const variant = (dayType: string, over: Row = {}) => ({
  dayType, targetCalories: 2100, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60,
  meals: [planMeal()], ...over,
})

const validPlan = (over: Row = {}) => ({
  name: 'Cut', mealsPerDay: 3, targetCalories: 2100,
  targetProteinG: 150, targetCarbsG: 200, targetFatG: 60,
  variants: [variant('all')], ...over,
})

const send = (
  handler: (req: never, ctx: never) => Promise<Response>,
  url: string, method: string, body: unknown, params?: Row,
) => handler(new Request(`http://localhost${url}`, {
  method, headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}) as never, (params ? { params: Promise.resolve(params) } : undefined) as never)

const postPlan = (body: unknown) => send(createPlan as never, '/api/nutrition/meal-plans', 'POST', body)
const getPlan = (id = PLAN) => send(readPlan as never, `/api/nutrition/meal-plans/${id}`, 'GET', undefined, { id })
const patchPlan = (body: unknown, id = PLAN) =>
  send(editPlan as never, `/api/nutrition/meal-plans/${id}`, 'PATCH', body, { id })
const delPlan = (id = PLAN) => send(removePlan as never, `/api/nutrition/meal-plans/${id}`, 'DELETE', undefined, { id })
const postReview = (id = PLAN) =>
  send(reviewPlan as never, `/api/nutrition/meal-plans/${id}/review`, 'POST', undefined, { id })
const patchMeal = (body: unknown, mealId = MEAL) =>
  send(editMeal as never, `/api/nutrition/meal-plans/meals/${mealId}`, 'PATCH', body, { mealId })

let seq = 0
const freshUser = () => { sessionUser = { id: `u-${++seq}` } }

beforeEach(() => {
  vi.clearAllMocks()
  freshUser()
  listMealPlans.mockResolvedValue([])
  createMealPlan.mockResolvedValue({ id: 'plan-1' })
  getMealPlan.mockResolvedValue({ id: 'plan-1', name: 'Cut' })
  updateMealPlan.mockResolvedValue({ id: 'plan-1' })
  setMealPlanActive.mockResolvedValue({ id: 'plan-1', isActive: true })
  deleteMealPlan.mockResolvedValue(true)
  markMealPlanReviewed.mockResolvedValue(true)
  getMealPlanMeal.mockResolvedValue(meal())
  updateMealPlanMeal.mockResolvedValue({ id: 'meal-1' })
  listUserDietaryRestrictions.mockResolvedValue([])
  scaleWithTopUp.mockImplementation(async (ing: unknown[]) => ing)
})

describe('/api/nutrition/meal-plans', () => {
  it('refuses both verbs without a session', async () => {
    sessionUser = null
    expect((await listPlans()).status).toBe(401)
    expect((await postPlan(validPlan())).status).toBe(401)
  })

  it('reports which of the caller\'s plans is active, uncacheable', async () => {
    listMealPlans.mockResolvedValue([{ id: 'p1', isActive: false }, { id: 'p2', isActive: true }])
    const res = await listPlans()
    expect(listMealPlans).toHaveBeenCalledWith(sessionUser!.id)
    expect(await res.json()).toEqual({
      plans: [{ id: 'p1', isActive: false }, { id: 'p2', isActive: true }], activePlanId: 'p2',
    })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('reports no active plan rather than guessing one', async () => {
    listMealPlans.mockResolvedValue([{ id: 'p1', isActive: false }])
    expect((await (await listPlans()).json()).activePlanId).toBeNull()
  })

  // 'all' alone, or the training/rest pair — never a partial split, which would leave one day type
  // with no plan at all.
  it('refuses a partial day-type split, and accepts both legitimate shapes', async () => {
    for (const variants of [
      [variant('training')],
      [variant('rest')],
      [variant('all'), variant('training')],
    ]) {
      const res = await postPlan(validPlan({ variants }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('training')
    }
    expect(createMealPlan).not.toHaveBeenCalled()

    expect((await postPlan(validPlan({ variants: [variant('all')] }))).status).toBe(201)
    expect((await postPlan(validPlan({ variants: [variant('rest'), variant('training')] }))).status).toBe(201)
    // Order does not matter: the check sorts before comparing.
    expect((await postPlan(validPlan({ variants: [variant('training'), variant('rest')] }))).status).toBe(201)
  })

  it('rejects an unknown key at every level of the body', async () => {
    // Each against a body that would otherwise succeed, so `.strict()` is what refuses it.
    expect((await postPlan(validPlan({ userId: 'someone-else' }))).status).toBe(400)
    expect((await postPlan(validPlan({ variants: [variant('all', { deletedAt: null })] }))).status).toBe(400)
    expect((await postPlan(validPlan({
      variants: [variant('all', { meals: [{ ...planMeal(), userId: 'someone-else' }] })],
    }))).status).toBe(400)
    expect(createMealPlan).not.toHaveBeenCalled()
  })

  it('bounds the plan, its variants and its meals', async () => {
    for (const bad of [
      { name: '' }, { name: 'x'.repeat(121) }, { mealsPerDay: 7 }, { targetCalories: 20_001 },
      { variants: [] },
      { variants: [variant('all', { meals: [] })] },
      { variants: [variant('all', { meals: [{ ...planMeal(), targetCalories: 10_001 }] })] },
    ]) {
      expect((await postPlan(validPlan(bad))).status).toBe(400)
    }
    expect(createMealPlan).not.toHaveBeenCalled()
  })

  it('keeps the ingredient snapshot the plan was built from', async () => {
    await postPlan(validPlan({
      variants: [variant('all', { meals: [{ ...planMeal(), ingredients: [ingredient()] }] })],
    }))
    const stored = createMealPlan.mock.calls[0][1] as { variants: Array<{ meals: Array<Row> }> }
    expect(stored.variants[0].meals[0].ingredients).toEqual([ingredient()])
  })

  it('refuses an oversized body', async () => {
    expect((await postPlan(validPlan({ avoidNote: 'x'.repeat(3 * 1024 * 1024) }))).status).toBe(413)
  })
})

describe('/api/nutrition/meal-plans/[id]', () => {
  it('refuses every verb without a session and on a malformed id', async () => {
    sessionUser = null
    expect((await getPlan()).status).toBe(401)
    expect((await patchPlan({ name: 'x' })).status).toBe(401)
    expect((await delPlan()).status).toBe(401)

    freshUser()
    expect((await getPlan('not-a-uuid')).status).toBe(400)
    expect((await patchPlan({ name: 'x' }, 'not-a-uuid')).status).toBe(400)
    expect((await delPlan('not-a-uuid')).status).toBe(400)
    expect(getMealPlan).not.toHaveBeenCalled()
  })

  // The route says why: a 403 makes an id that exists distinguishable from one that does not, which
  // turns the id space into an enumeration oracle.
  it('answers 404, never 403, for a plan that is not the caller\'s', async () => {
    getMealPlan.mockResolvedValue(null)
    updateMealPlan.mockResolvedValue(null)
    deleteMealPlan.mockResolvedValue(false)
    markMealPlanReviewed.mockResolvedValue(false)

    for (const res of [await getPlan(), await patchPlan({ name: 'x' }), await delPlan(), await postReview()]) {
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Not found' })
    }
  })

  // Writing `isActive` as a column would leave two plans active; `setMealPlanActive` clears the
  // previous one in the same transaction.
  it('routes activation through the transactional path, not the field patch', async () => {
    const res = await patchPlan({ isActive: true })
    expect(res.status).toBe(200)
    expect(setMealPlanActive).toHaveBeenCalledWith(PLAN, sessionUser!.id, true)
    expect(updateMealPlan).not.toHaveBeenCalled()

    // And deactivation takes the same path rather than becoming a no-op.
    setMealPlanActive.mockClear()
    await patchPlan({ isActive: false })
    expect(setMealPlanActive).toHaveBeenCalledWith(PLAN, sessionUser!.id, false)
  })

  it('updates the other fields, and both when both are sent', async () => {
    await patchPlan({ name: 'Bulk' })
    expect(updateMealPlan).toHaveBeenCalledWith(PLAN, sessionUser!.id, { name: 'Bulk' })
    expect(setMealPlanActive).not.toHaveBeenCalled()

    updateMealPlan.mockClear()
    await patchPlan({ name: 'Bulk', isActive: true })
    expect(updateMealPlan).toHaveBeenCalledWith(PLAN, sessionUser!.id, { name: 'Bulk' })
    expect(setMealPlanActive).toHaveBeenCalled()
  })

  it('rejects a body carrying a column the patch does not own', async () => {
    for (const bad of [
      { name: 'Bulk', userId: 'someone-else' },
      { name: 'Bulk', deletedAt: null },
      { name: '' },
      { trainingTime: '7am' },
    ]) {
      expect((await patchPlan(bad)).status).toBe(400)
    }
    expect(updateMealPlan).not.toHaveBeenCalled()
    expect(setMealPlanActive).not.toHaveBeenCalled()
  })

  it('deletes softly and says so once', async () => {
    const res = await delPlan()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(deleteMealPlan).toHaveBeenCalledWith(PLAN, sessionUser!.id)
  })

  it('records a review against the caller\'s own plan', async () => {
    const res = await postReview()
    expect(res.status).toBe(200)
    expect(markMealPlanReviewed).toHaveBeenCalledWith(PLAN, sessionUser!.id)
  })
})

describe('PATCH /api/nutrition/meal-plans/meals/[mealId]', () => {
  it('refuses without a session and on a malformed id', async () => {
    sessionUser = null
    expect((await patchMeal({ name: 'Lunch' })).status).toBe(401)

    freshUser()
    expect((await patchMeal({ name: 'Lunch' }, 'not-a-uuid')).status).toBe(400)
    expect(updateMealPlanMeal).not.toHaveBeenCalled()
  })

  it('404s a meal that is not the caller\'s — ownership is proven through its plan', async () => {
    updateMealPlanMeal.mockResolvedValue(null)
    expect((await patchMeal({ name: 'Lunch' })).status).toBe(404)
  })

  // A rename PATCHes this same route. Repricing it would change the food under the user and spend
  // an AI call they did not ask for.
  it('does not scale a rename', async () => {
    await patchMeal({ name: 'Second lunch' })
    expect(scaleWithTopUp).not.toHaveBeenCalled()
    expect(getMealPlanMeal).not.toHaveBeenCalled()
    expect(updateMealPlanMeal).toHaveBeenCalledWith(MEAL, sessionUser!.id, { name: 'Second lunch' })
  })

  it('stores ingredients exactly as sent when scaling is not asked for', async () => {
    await patchMeal({ ingredients: [ingredient()] })
    expect(scaleWithTopUp).not.toHaveBeenCalled()
    expect((updateMealPlanMeal.mock.calls[0][2] as Row).ingredients).toEqual([ingredient()])
  })

  it('asking to scale without ingredients scales nothing', async () => {
    await patchMeal({ scaleToTarget: true, name: 'Lunch' })
    expect(scaleWithTopUp).not.toHaveBeenCalled()
    // `scaleToTarget` is a control flag, never a stored column.
    expect(updateMealPlanMeal.mock.calls[0][2]).not.toHaveProperty('scaleToTarget')
  })

  // The targets are re-read rather than taken from the request: a client sending the wrong ones
  // would otherwise silently reprice the meal.
  it('scales against the meal\'s own stored targets, not the caller\'s numbers', async () => {
    getMealPlanMeal.mockResolvedValue(meal({ targetCalories: 700, targetProteinG: 50 }))
    scaleWithTopUp.mockResolvedValue([ingredient({ weightG: 250 })])
    await patchMeal({
      scaleToTarget: true, ingredients: [ingredient()],
      targetCalories: 99, targetProteinG: 1,   // wrong on purpose
    })
    expect(scaleWithTopUp.mock.calls[0][1]).toEqual({
      calories: 700, proteinG: 50, carbsG: 60, fatG: 20,
    })
    expect((updateMealPlanMeal.mock.calls[0][2] as Row).ingredients).toEqual([ingredient({ weightG: 250 })])
  })

  it('hands the top-up the caller\'s allergies and avoidances, kept apart', async () => {
    listUserDietaryRestrictions.mockResolvedValue([
      { label: 'Peanuts', severity: 'allergy' },
      { label: 'Coriander', severity: 'avoid' },
    ])
    await patchMeal({ scaleToTarget: true, ingredients: [ingredient()] })
    expect(scaleWithTopUp.mock.calls[0][2]).toMatchObject({
      userId: sessionUser!.id, allergies: ['Peanuts'], avoid: ['Coriander'],
    })
  })

  it('404s before scaling when the meal is not the caller\'s', async () => {
    getMealPlanMeal.mockResolvedValue(null)
    const res = await patchMeal({ scaleToTarget: true, ingredients: [ingredient()] })
    expect(res.status).toBe(404)
    expect(scaleWithTopUp).not.toHaveBeenCalled()
    expect(updateMealPlanMeal).not.toHaveBeenCalled()
  })

  it('rejects an unknown key and an out-of-range ingredient', async () => {
    expect((await patchMeal({ name: 'Lunch', userId: 'someone-else' })).status).toBe(400)
    expect((await patchMeal({ ingredients: [ingredient({ proteinPer100g: 101 })] })).status).toBe(400)
    expect((await patchMeal({ suggestedTime: 'noon' })).status).toBe(400)
    expect(updateMealPlanMeal).not.toHaveBeenCalled()
  })
})
