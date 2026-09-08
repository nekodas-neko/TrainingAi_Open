/**
 * PS-39 — `PATCH /api/nutrition/meal-plans/[id]/structure`, the reshape.
 *
 * It changes a saved plan's shape — how many meals it splits into, when training sits, whether it
 * still runs against the calorie target it was built for, and what order the meals come in — with
 * **no AI involved**. All of it is redistribution through `splitMacrosAcrossMeals`, the same
 * function the generator used, so the answer is deterministic. That is what makes it worth pinning
 * rather than trusting: the route's value is entirely in decisions the response shape hides.
 *
 *   · **A reorder must be a permutation of the slots that exist.** Anything else duplicates one
 *     meal and silently drops another.
 *   · **The food survives a reshape; only the numbers move.** Names, notes and the ingredient
 *     snapshot carry over by position, and portions are deliberately NOT rescaled — the new target
 *     is shown against unchanged ingredients so the drift is visible rather than hidden.
 *   · **A slot that did not exist before is reported, not disguised.** `unnamedPositions` is what
 *     lets the client say "placeholder" instead of implying new food was invented.
 *   · **`retarget` never derives a third number** — the saved target wins, the calibration fills
 *     the gap, and when neither exists it refuses rather than guessing.
 *   · **Changing the day-type split is a rebuild, not a reshape**, so the plan keeps whichever
 *     variants it already had.
 *
 * `splitMacrosAcrossMeals` is deliberately REAL — the determinism is the claim. `computeEnergyBalance`
 * is mocked; it is a heavy service with its own tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const getMealPlan = vi.fn(async (_id: string, _u: string) => plan() as Row | null)
const replaceMealPlanStructure = vi.fn(async (_id: string, _u: string, _s: Row) => ({ id: 'plan-1' }) as Row | null)
const getNutritionTargets = vi.fn(async (_u: string) => null as Row | null)
const computeEnergyBalance = vi.fn(async (..._a: unknown[]) =>
  ({ target: { recommendedKcal: null as number | null } }) as Row)

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the returned function: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({ getMealPlan, replaceMealPlanStructure, getNutritionTargets })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@/lib/health/energy-balance-service', () => ({
  computeEnergyBalance: (...a: unknown[]) => computeEnergyBalance(...a),
}))

import { PATCH as reshape } from '@/app/api/nutrition/meal-plans/[id]/structure/route'

const PLAN = '00000000-0000-4000-8000-0000000000e1'

const savedMeal = (position: number, name: string, over: Row = {}) => ({
  position, name, notes: `${name} notes`, savedMealId: null, mealTypeId: null,
  ingredients: [{ name: `${name} food`, weightG: 100, caloriesPer100g: 100, proteinPer100g: 10, carbsPer100g: 10, fatPer100g: 5 }],
  ...over,
})

const plan = (over: Row = {}) => ({
  id: PLAN, mealsPerDay: 3, trainingTime: '17:00',
  targetCalories: 2400, targetProteinG: 150, targetCarbsG: 250, targetFatG: 80,
  variants: [{
    dayType: 'all',
    meals: [savedMeal(0, 'Breakfast'), savedMeal(1, 'Lunch'), savedMeal(2, 'Dinner')],
  }],
  ...over,
})

const patch = (body: unknown, id = PLAN) =>
  reshape(new Request(`http://localhost/api/nutrition/meal-plans/${id}/structure`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never, { params: Promise.resolve({ id }) } as never)

/** What the route asked the repository to store. */
const stored = () => replaceMealPlanStructure.mock.calls[0][2] as {
  mealsPerDay: number; trainingTime: string | null
  targetCalories: number; targetProteinG: number; targetCarbsG: number; targetFatG: number
  variants: Array<{ dayType: string; targetCalories: number; targetCarbsG: number; meals: Array<Row> }>
}

let seq = 0
const freshUser = () => { sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane' } }

beforeEach(() => {
  vi.clearAllMocks()
  freshUser()
  getMealPlan.mockResolvedValue(plan())
  replaceMealPlanStructure.mockResolvedValue({ id: 'plan-1' })
  getNutritionTargets.mockResolvedValue(null)
  computeEnergyBalance.mockResolvedValue({ target: { recommendedKcal: null } })
})

describe('PATCH …/meal-plans/[id]/structure — refusals', () => {
  it('refuses without a session and on a malformed id', async () => {
    sessionUser = null
    expect((await patch({ mealsPerDay: 4 })).status).toBe(401)

    freshUser()
    expect((await patch({ mealsPerDay: 4 }, 'not-a-uuid')).status).toBe(400)
    expect(getMealPlan).not.toHaveBeenCalled()
  })

  it('404s a plan that is not the caller\'s, before computing anything', async () => {
    getMealPlan.mockResolvedValue(null)
    expect((await patch({ mealsPerDay: 4 })).status).toBe(404)
    expect(replaceMealPlanStructure).not.toHaveBeenCalled()
  })

  it('rejects an unknown key and an out-of-range meal count', async () => {
    // Against a body that would otherwise succeed, so `.strict()` is what refuses it.
    expect((await patch({ mealsPerDay: 4, userId: 'someone-else' })).status).toBe(400)
    expect((await patch({ mealsPerDay: 7 })).status).toBe(400)
    expect((await patch({ mealsPerDay: 0 })).status).toBe(400)
    expect((await patch({ trainingTime: '5pm' })).status).toBe(400)
    expect(replaceMealPlanStructure).not.toHaveBeenCalled()
  })

  it('refuses an oversized body', async () => {
    expect((await patch({ mealsPerDay: 4, trainingTime: '1'.repeat(64 * 1024) })).status).toBe(413)
  })

  // Anything but a permutation duplicates one meal and silently drops another.
  it('refuses an order that is not a permutation of the existing slots', async () => {
    for (const order of [[0, 0, 1], [0, 1], [0, 1, 3], [0, 1, 2, 2]]) {
      const res = await patch({ order })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('exactly once')
    }
    expect(replaceMealPlanStructure).not.toHaveBeenCalled()
  })

  it('validates the order against the NEW meal count when both change together', async () => {
    // Growing to four slots makes [0,1,2] short, and [0,1,2,3] correct.
    expect((await patch({ mealsPerDay: 4, order: [0, 1, 2] })).status).toBe(400)
    expect((await patch({ mealsPerDay: 4, order: [3, 0, 1, 2] })).status).toBe(200)
  })
})

describe('PATCH …/structure — the food survives, only the numbers move', () => {
  it('carries names, notes and the ingredient snapshot over by position', async () => {
    await patch({ mealsPerDay: 3 })
    const meals = stored().variants[0].meals
    expect(meals.map(m => m.name)).toEqual(['Breakfast', 'Lunch', 'Dinner'])
    expect(meals[1].notes).toBe('Lunch notes')
    // Portions are NOT rescaled — the new target is shown against unchanged ingredients.
    expect(meals[0].ingredients).toEqual(plan().variants[0].meals[0].ingredients)
  })

  it('moves a meal\'s food with it when the order changes', async () => {
    // [2, 0, 1] — "the third meal now comes first".
    await patch({ order: [2, 0, 1] })
    const meals = stored().variants[0].meals
    expect(meals.map(m => m.name)).toEqual(['Dinner', 'Breakfast', 'Lunch'])
    expect(meals[0].notes).toBe('Dinner notes')
    expect(meals[0].position).toBe(0)
  })

  it('names a slot that did not exist plainly, and reports it as unnamed', async () => {
    const res = await patch({ mealsPerDay: 5 })
    const body = await res.json()
    const meals = stored().variants[0].meals
    expect(meals.map(m => m.name)).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Meal 4', 'Meal 5'])
    expect(meals[3].ingredients).toEqual([])
    expect(body.unnamedPositions).toEqual([3, 4])
  })

  it('reports nothing unnamed when every slot carried over', async () => {
    expect((await (await patch({ mealsPerDay: 3 })).json()).unnamedPositions).toEqual([])
  })

  it('drops the slots that no longer exist when the plan shrinks', async () => {
    await patch({ mealsPerDay: 2 })
    const meals = stored().variants[0].meals
    expect(meals).toHaveLength(2)
    expect(meals.map(m => m.name)).toEqual(['Breakfast', 'Lunch'])
  })
})

describe('PATCH …/structure — the split', () => {
  it('splits the plan\'s own totals across the new meal count', async () => {
    await patch({ mealsPerDay: 4 })
    const v = stored().variants[0]
    expect(v.meals).toHaveLength(4)
    // Every macro is distributed, not duplicated: the parts sum to the whole.
    const sum = (k: string) => v.meals.reduce((t, m) => t + (m[k] as number), 0)
    expect(sum('targetProteinG')).toBeCloseTo(150, 0)
    expect(sum('targetCarbsG')).toBeCloseTo(250, 0)
    expect(sum('targetFatG')).toBeCloseTo(80, 0)
    expect(stored().mealsPerDay).toBe(4)
  })

  it('gives every meal a suggested time, in order', async () => {
    await patch({ mealsPerDay: 4 })
    const times = stored().variants[0].meals.map(m => m.suggestedTime as string)
    expect(times).toHaveLength(4)
    for (const t of times) expect(t).toMatch(/^\d{1,2}:\d{2}$/)
    const minutes = times.map(t => Number(t.split(':')[0]) * 60 + Number(t.split(':')[1]))
    expect([...minutes].sort((a, b) => a - b)).toEqual(minutes)
  })

  it('keeps the training time unless the request changes it, and can clear it', async () => {
    await patch({ mealsPerDay: 3 })
    expect(stored().trainingTime).toBe('17:00')

    replaceMealPlanStructure.mockClear()
    await patch({ trainingTime: '06:30' })
    expect(stored().trainingTime).toBe('06:30')

    replaceMealPlanStructure.mockClear()
    await patch({ trainingTime: null })
    expect(stored().trainingTime).toBeNull()
  })

  // Changing the split is a rebuild, not a reshape.
  it('keeps whichever day types the plan already had', async () => {
    getMealPlan.mockResolvedValue(plan({
      variants: [
        { dayType: 'training', meals: [savedMeal(0, 'Breakfast')] },
        { dayType: 'rest', meals: [savedMeal(0, 'Brunch')] },
      ],
    }))
    await patch({ mealsPerDay: 2 })
    expect(stored().variants.map(v => v.dayType)).toEqual(['training', 'rest'])
  })

  it('takes 15% of carbs off a rest day, and the calories with them', async () => {
    getMealPlan.mockResolvedValue(plan({
      variants: [
        { dayType: 'training', meals: [savedMeal(0, 'Breakfast')] },
        { dayType: 'rest', meals: [savedMeal(0, 'Brunch')] },
      ],
    }))
    await patch({ mealsPerDay: 3 })
    const [training, rest] = stored().variants
    const shift = Math.round(250 * 0.15)
    expect(training.targetCarbsG).toBe(250)
    expect(rest.targetCarbsG).toBe(250 - shift)
    // The calories follow the carbohydrate at 4 kcal a gram rather than drifting apart.
    expect(training.targetCalories - rest.targetCalories).toBe(shift * 4)
  })
})

describe('PATCH …/structure — retarget', () => {
  it('does not touch the totals when retarget is not asked for', async () => {
    await patch({ mealsPerDay: 4 })
    expect(stored().targetCalories).toBe(2400)
    expect(getNutritionTargets).not.toHaveBeenCalled()
    expect(computeEnergyBalance).not.toHaveBeenCalled()
  })

  // The saved target wins; the calibration fills the gap. The route never derives a third number.
  it('prefers the saved targets over the calibration', async () => {
    getNutritionTargets.mockResolvedValue({ calories: 2000, proteinG: 160, carbsG: 200, fatG: 60 })
    computeEnergyBalance.mockResolvedValue({ target: { recommendedKcal: 9999 } })
    await patch({ retarget: true })
    expect(stored().targetCalories).toBe(2000)
    expect(stored().targetProteinG).toBe(160)
  })

  it('falls back to the calibration when nothing is saved', async () => {
    computeEnergyBalance.mockResolvedValue({ target: { recommendedKcal: 1800 } })
    await patch({ retarget: true })
    expect(stored().targetCalories).toBe(1800)
    // Protein and fat are derived from that number rather than left at the old plan's.
    expect(stored().targetProteinG).toBe(Math.round(1800 * 0.3 / 4))
    expect(stored().targetFatG).toBe(Math.round(1800 * 0.25 / 9))
  })

  it('refuses rather than guessing when there is no target anywhere', async () => {
    const res = await patch({ retarget: true })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('set one in Nutrition first')
    expect(replaceMealPlanStructure).not.toHaveBeenCalled()
  })

  // Saved macros need not sum to the calorie goal; the same reconciliation the generator applies.
  it('reconciles saved macros that do not add up to their own calorie goal', async () => {
    getNutritionTargets.mockResolvedValue({ calories: 2000, proteinG: 150, carbsG: 400, fatG: 60 })
    await patch({ retarget: true })
    const { targetCalories, targetProteinG, targetCarbsG, targetFatG } = stored()
    expect(targetCalories).toBe(2000)
    // Calories win: protein and fat are kept, carbohydrate takes the remainder.
    expect(targetProteinG).toBe(150)
    expect(targetFatG).toBe(60)
    expect(targetProteinG * 4 + targetCarbsG * 4 + targetFatG * 9).toBeCloseTo(2000, -1)
    expect(targetCarbsG).not.toBe(400)
  })

  it('uses the caller\'s timezone for the calibration day', async () => {
    sessionUser = { id: 'u-tz', timezone: 'Etc/GMT-14' }
    computeEnergyBalance.mockResolvedValue({ target: { recommendedKcal: 1800 } })
    await patch({ retarget: true })
    const [, , tz, day] = computeEnergyBalance.mock.calls[0]
    expect(tz).toBe('Etc/GMT-14')
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('answers no-store, because a plan is not shared-cacheable', async () => {
    expect((await patch({ mealsPerDay: 3 })).headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('404s when the structure write finds no plan to replace', async () => {
    replaceMealPlanStructure.mockResolvedValue(null)
    expect((await patch({ mealsPerDay: 3 })).status).toBe(404)
  })
})
