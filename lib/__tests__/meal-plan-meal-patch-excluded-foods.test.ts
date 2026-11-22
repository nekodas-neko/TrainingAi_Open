// #3749 review. The single-meal PATCH with `scaleToTarget` tops a meal up by arithmetic first, with
// no model in the loop to be told what to avoid. The plan's excluded foods, with the person's
// allergies and avoid list, must reach that top-up, or an excluded staple is added silently.
//
// The real `scaleWithTopUp` and `planStapleTopUp` run here; only the repository, the auth and the
// model are replaced, and the model must not be called (mocks only: no Gemini call is made).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { referenceRowFor } from '@trainingai/shared/nutrition/food-reference/resolve'

const USER = 'u-patch-3749'
const PLAN = '00000000-0000-4000-8000-0000000000c9'
const MEAL = '00000000-0000-4000-8000-0000000000d9'
const VARIANT = '00000000-0000-4000-8000-0000000000e9'

const fromTable = (name: string, weightG: number) => {
  const r = referenceRowFor(name)!
  return { name, weightG, caloriesPer100g: r.kcal, proteinPer100g: r.proteinG, carbsPer100g: r.carbsG, fatPer100g: r.fatG }
}
// Chicken and broccoli into a slot that wants carbohydrate: only a carb staple can close it.
const ingredients = [fromTable('chicken breast, grilled', 150), fromTable('broccoli', 100), fromTable('olive oil', 10)]

const state = {
  excludedFoods: [] as string[],
  restrictions: [] as { label: string; severity: string }[],
  saved: [] as { name: string }[][],
}
const modelCalls = vi.fn()

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: USER } }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/ai/instrument', () => ({
  contentKey: (...parts: unknown[]) => parts.join('|'),
  loggedGenerateObject: async (_m: unknown, run: (s: AbortSignal, settings: object) => Promise<unknown>) =>
    run(new AbortController().signal, {}),
}))
vi.mock('ai', () => ({ generateObject: vi.fn(async () => { modelCalls(); return { object: { ingredients: [] } } }) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getMealPlanMeal: async () => ({
      id: MEAL, variantId: VARIANT, name: 'Lunch', position: 0,
      targetCalories: 600, targetProteinG: 45, targetCarbsG: 60, targetFatG: 15,
    }),
    listMealPlans: async () => [{ id: PLAN, excludedFoods: state.excludedFoods, variants: [{ id: VARIANT, meals: [] }] }],
    listUserDietaryRestrictions: async () => state.restrictions,
    listFoodItemsByNames: async () => [],
    updateMealPlanMeal: async (_id: string, _u: string, input: unknown) => { state.saved.push(input as never); return { id: MEAL } },
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { PATCH } from '@/app/api/nutrition/meal-plans/meals/[mealId]/route'

const patch = () => PATCH(
  new Request('http://localhost/x', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scaleToTarget: true, ingredients }),
  }) as never,
  { params: Promise.resolve({ mealId: MEAL }) } as never,
)
const savedNames = () => ((state.saved.at(-1) as unknown as { ingredients: { name: string }[] }).ingredients).map(i => i.name)

beforeEach(() => {
  state.excludedFoods = []
  state.restrictions = []
  state.saved = []
  modelCalls.mockClear()
})

describe('PATCH meal with scaleToTarget: the arithmetic top-up respects what the person excluded', () => {
  it('adds rice, by arithmetic and with no model call, when nothing is excluded', async () => {
    expect((await patch()).status).toBe(200)
    expect(savedNames()).toContain('white rice, cooked')
    expect(modelCalls).not.toHaveBeenCalled()
  })

  it('never adds a staple the plan excludes', async () => {
    state.excludedFoods = ['Rice']
    await patch()
    expect(savedNames()).not.toContain('white rice, cooked')
    expect(savedNames()).toContain('potatoes, boiled')
  })

  it('never adds a staple an allergy or an avoid rules out', async () => {
    state.restrictions = [{ label: 'Potato', severity: 'avoid' }, { label: 'Rice', severity: 'allergy' }]
    await patch()
    expect(savedNames()).not.toEqual(expect.arrayContaining(['white rice, cooked']))
    expect(savedNames()).not.toEqual(expect.arrayContaining(['potatoes, boiled']))
  })

  it('asks the model once, rather than adding anything, when every staple for the gap is excluded', async () => {
    state.excludedFoods = ['Rice', 'Potato']
    await patch()
    expect(modelCalls).toHaveBeenCalledTimes(1)
    expect(savedNames()).toEqual(['chicken breast, grilled', 'broccoli', 'olive oil'])
  })
})
