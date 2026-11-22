// #3749. The four AI food routes share one ingredient schema and take code's per-100 g numbers
// wherever it knows the food. Mocks only: the model is `ai.generateObject` replaced, so these tests
// make no Gemini call.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { z } from 'zod'
import { ModelIngredientSchema } from '@trainingai/shared/nutrition/ingredient-schema'
import { referenceRowFor } from '@trainingai/shared/nutrition/food-reference/resolve'
import type { NutritionIngredient } from '@trainingai/shared/types/nutrition'

const USER = '00000000-0000-4000-8000-000000003749'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER, timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/ai/instrument', () => ({
  bytesKey: () => 'k',
  contentKey: (...parts: unknown[]) => parts.join('|'),
  loggedGenerateObject: async (_meta: unknown, run: (s: AbortSignal, settings: object) => Promise<unknown>) =>
    run(new AbortController().signal, {}),
}))

/** Each call's options, and the reply the next call gets. */
const model = { calls: [] as { schema: z.ZodTypeAny; prompt?: string }[], reply: (_o: unknown): unknown => ({}) }
vi.mock('ai', () => ({
  generateObject: vi.fn(async (opts: { schema: z.ZodTypeAny; prompt?: string }) => {
    model.calls.push(opts)
    return { object: model.reply(opts) }
  }),
}))

vi.mock('@/lib/health/energy-balance-service', () => ({
  computeEnergyBalance: async () => ({
    target: { recommendedKcal: 2000 },
    balance: { restingBaseKcal: 2000, activeKcal: 0, targetNetKcal: 0 },
  }),
}))

type SavedFood = { id: string; userId: string; name: string; source: string; servingSizeG: number; calories: number; proteinG: number; carbsG: number; fatG: number }
const db = { foods: [] as SavedFood[] }
const repo = {
  // User-scoped like the real slice: the route can only ever see its own user's foods.
  listFoodItemsByNames: vi.fn(async (userId: string, names: readonly string[]) => {
    const wanted = new Set(names.map(n => n.trim().toLowerCase().replace(/\s+/g, ' ')))
    return db.foods.filter(f => f.userId === userId && wanted.has(f.name.toLowerCase()))
  }),
  getNutritionTargets: vi.fn(async () => ({ calories: 2000, proteinG: 150, carbsG: 200, fatG: 67 })),
  listUserDietaryRestrictions: vi.fn(async () => []),
  getMostRecentConfirmedWeightKg: vi.fn(async () => 72),
  listSavedMeals: vi.fn(async () => []),
  listMealTypes: vi.fn(async () => []),
}
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))

let scanPOST: (req: Request) => Promise<Response>
let planPOST: (req: Request) => Promise<Response>
let mealPOST: (req: Request) => Promise<Response>
let scaleWithTopUp: typeof import('@/lib/nutrition/meal-top-up').scaleWithTopUp
beforeAll(async () => {
  ({ POST: scanPOST } = await import('@/app/api/nutrition/scan/route'))
  ;({ POST: planPOST } = await import('@/app/api/nutrition/meal-plans/generate/route'))
  ;({ POST: mealPOST } = await import('@/app/api/nutrition/meal-plans/generate/meal/route'))
  ;({ scaleWithTopUp } = await import('@/lib/nutrition/meal-top-up'))
}, 30_000)

beforeEach(() => {
  model.calls.length = 0
  db.foods = []
  repo.listFoodItemsByNames.mockClear()
})

const post = (fn: (r: Request) => Promise<Response>, body: unknown) =>
  fn(new Request('http://test/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
    .then(r => r.json())

/** Deliberately wrong numbers, so a test can tell the model's from the table's. */
const guess = (name: string, weightG: number) => ({
  name, weightG, caloriesPer100g: 500, proteinPer100g: 30, carbsPer100g: 30, fatPer100g: 28,
})
const per100 = (i: NutritionIngredient) => [i.caloriesPer100g, i.proteinPer100g, i.carbsPer100g, i.fatPer100g]
const tableNumbers = (name: string) => { const r = referenceRowFor(name)!; return [r.kcal, r.proteinG, r.carbsG, r.fatG] }

const scanReply = (ingredients: unknown[]) => () => ({
  identified: true,
  candidates: [{ name: 'Lunch', brand: null, notes: null, fiberG: 0, sugarG: 0, sodiumMg: 0, satFatG: 0, ingredients }],
})
type ScanBody = { confidence: string; calories: number; ingredients: NutritionIngredient[]; candidates: { confidence: string }[] }
const scanText = () => post(scanPOST, { text: 'lunch' }) as Promise<ScanBody>

/** The ingredient element of a schema at `path` (object keys and array elements). */
function ingredientElement(schema: z.ZodTypeAny, path: string[]): unknown {
  let s: unknown = schema
  for (const key of path) {
    const def = (s as { _def?: { type?: string; element?: unknown }; shape?: Record<string, unknown> })
    s = key === '[]' ? (def as { element?: unknown }).element ?? def._def?.element : def.shape?.[key]
  }
  return s
}

describe('one ingredient schema in all four routes', () => {
  it('the scan asks for it, and no longer asks for confidence', async () => {
    model.reply = scanReply([guess('banana', 120)])
    await scanText()
    const schema = model.calls[0].schema
    expect(ingredientElement(schema, ['candidates', '[]', 'ingredients', '[]'])).toBe(ModelIngredientSchema)
    expect(Object.keys((ingredientElement(schema, ['candidates', '[]']) as z.ZodObject<z.ZodRawShape>).shape)).not.toContain('confidence')
  })

  it('the whole-day plan asks for it', async () => {
    model.reply = () => ({ planName: 'P', meals: [], restDayAdjustment: '' })
    await post(planPOST, { mealCount: 3 })
    expect(ingredientElement(model.calls[0].schema, ['meals', '[]', 'ingredients', '[]'])).toBe(ModelIngredientSchema)
  })

  it('the one-meal route asks for it', async () => {
    model.reply = () => ({ name: 'M', ingredients: [], notes: '' })
    await post(mealPOST, { targetCalories: 500, targetProteinG: 30, targetCarbsG: 50, targetFatG: 15 })
    expect(ingredientElement(model.calls[0].schema, ['ingredients', '[]'])).toBe(ModelIngredientSchema)
  })

  it('the top-up asks for it', async () => {
    model.reply = () => ({ ingredients: [] })
    // A meal the table cannot read (no style), so the staples step hands it to the model.
    await scaleWithTopUp([{ name: 'house special', weightG: 300, caloriesPer100g: 100, proteinPer100g: 10, carbsPer100g: 1, fatPer100g: 5 }],
      { calories: 600, proteinG: 30, carbsG: 70, fatG: 20 }, { userId: USER, mealName: 'X', allergies: [], avoid: [] })
    expect(ingredientElement(model.calls[0].schema, ['ingredients', '[]'])).toBe(ModelIngredientSchema)
  })
})

describe('the scan takes code\'s numbers and its badge from code', () => {
  it('every ingredient matched: badge high, numbers from the table, the model\'s ignored', async () => {
    model.reply = scanReply([guess('banana', 120), guess('rolled oats, dry', 50)])
    const body = await scanText()
    expect(body.confidence).toBe('high')
    expect(body.candidates[0].confidence).toBe('high')
    expect(per100(body.ingredients[0])).toEqual(tableNumbers('banana'))
    expect(per100(body.ingredients[1])).toEqual(tableNumbers('rolled oats, dry'))
    expect(body.ingredients.some(i => i.estimated)).toBe(false)
    const [b, o] = [referenceRowFor('banana')!, referenceRowFor('rolled oats, dry')!]
    expect(body.calories).toBe(Math.round(b.kcal * 1.2 + o.kcal * 0.5))
  })

  it('some matched, carrying at least half the calories: badge medium, the unmatched one keeps the model\'s numbers and is marked', async () => {
    model.reply = scanReply([guess('banana', 120), guess('nana\'s secret sauce', 10)])   // 107 of 157 kcal
    const body = await scanText()
    expect(body.confidence).toBe('medium')
    expect(per100(body.ingredients[1])).toEqual([500, 30, 30, 28])
    expect(body.ingredients[1].estimated).toBe(true)
    expect(body.ingredients[0].estimated).toBeUndefined()
  })

  it('a matched garnish beside an unmatched heavy ingredient: badge low, not medium', async () => {
    model.reply = scanReply([guess('cucumber', 20), guess('nana\'s lasagne', 200)])
    const body = await scanText()
    expect(body.confidence).toBe('low')
    expect(body.candidates[0].confidence).toBe('low')
  })

  it('none matched: badge low, numbers exactly as the model gave them, each marked', async () => {
    model.reply = scanReply([guess('mystery stew', 300), guess('house bread', 60)])
    const body = await scanText()
    expect(body.confidence).toBe('low')
    expect(body.ingredients.map(per100)).toEqual([[500, 30, 30, 28], [500, 30, 30, 28]])
    expect(body.ingredients.every(i => i.estimated === true)).toBe(true)
  })

  it('low whenever sanitiseNutrition corrected the totals, even with every ingredient matched', async () => {
    // 2500 g of butter is past the sanitiser's 2000 g serving and 3000 kcal caps, so it corrects.
    model.reply = scanReply([guess('butter', 2500)])
    const body = await scanText()
    expect(body.confidence).toBe('low')
  })

  it('prefers the user\'s own barcode food, and never a saved food that came from an AI scan', async () => {
    db.foods = [
      { id: 'mine', userId: USER, name: 'banana', source: 'barcode', servingSizeG: 100, calories: 95, proteinG: 1, carbsG: 23, fatG: 0.3 },
      { id: 'ai-guess', userId: USER, name: 'rolled oats, dry', source: 'ai', servingSizeG: 100, calories: 300, proteinG: 9, carbsG: 50, fatG: 5 },
    ]
    model.reply = scanReply([guess('banana', 100), guess('rolled oats, dry', 50)])
    const body = await scanText()
    expect(per100(body.ingredients[0])).toEqual([95, 1, 23, 0.3])
    expect(per100(body.ingredients[1])).toEqual(tableNumbers('rolled oats, dry'))
  })

  it('never takes a saved barcode food of a state-dependent name: a bag of dry rice is not the plate', async () => {
    db.foods = [{ id: 'bag', userId: USER, name: 'Rice', source: 'barcode', servingSizeG: 100, calories: 360, proteinG: 7, carbsG: 79, fatG: 0.6 }]
    model.reply = scanReply([{ ...guess('Rice', 200), caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3 }])
    const body = await scanText()
    expect(per100(body.ingredients[0])).toEqual([130, 2.7, 28, 0.3])
    expect(body.ingredients[0].estimated).toBe(true)
    expect(body.confidence).toBe('low')
  })

  it('never resolves another user\'s saved food', async () => {
    db.foods = [{ id: 'theirs', userId: '00000000-0000-4000-8000-0000000099ff', name: 'banana', source: 'barcode', servingSizeG: 100, calories: 10, proteinG: 0, carbsG: 2, fatG: 0 }]
    model.reply = scanReply([guess('banana', 100)])
    const body = await scanText()
    expect(per100(body.ingredients[0])).toEqual(tableNumbers('banana'))
    expect(repo.listFoodItemsByNames).toHaveBeenCalledTimes(1)
    expect(repo.listFoodItemsByNames.mock.calls[0][0]).toBe(USER)
  })
})

describe('the same food gets the same numbers everywhere', () => {
  it('a scan and a meal plan agree on a matched food, whatever the model said in each', async () => {
    model.reply = scanReply([{ ...guess('olive oil', 10), caloriesPer100g: 820, fatPer100g: 92 }])
    const scanned = (await scanText()).ingredients[0]

    model.reply = () => ({
      planName: 'P', restDayAdjustment: '',
      meals: [{ name: 'Dinner', notes: '', ingredients: [{ ...guess('olive oil', 15), caloriesPer100g: 900, fatPer100g: 100 }] }],
    })
    const plan = await post(planPOST, { mealCount: 1 }) as { variants: { meals: { ingredients: NutritionIngredient[] }[] }[] }
    const planned = plan.variants[0].meals[0].ingredients.find(i => i.name === 'olive oil')!
    expect(per100(planned)).toEqual(per100(scanned))
    expect(per100(planned)).toEqual(tableNumbers('olive oil'))
  })

  it('the one-meal route resolves too, and accepts a meal sent back with its estimated marks', async () => {
    model.reply = () => ({ name: 'M', notes: '', ingredients: [guess('banana', 120), guess('odd thing', 20)] })
    const body = await post(mealPOST, {
      targetCalories: 200, targetProteinG: 2, targetCarbsG: 40, targetFatG: 2,
      instruction: 'less sugar',
      currentMeal: { name: 'M', ingredients: [{ ...guess('odd thing', 20), estimated: true }] },
    }) as { ingredients: NutritionIngredient[]; error?: string }
    expect(body.error).toBeUndefined()
    expect(per100(body.ingredients.find(i => i.name === 'banana')!)).toEqual(tableNumbers('banana'))
    expect(body.ingredients.find(i => i.name === 'odd thing')!.estimated).toBe(true)
  })
})

describe('top-up by arithmetic first', () => {
  const fromTable = (name: string, weightG: number): NutritionIngredient => {
    const r = referenceRowFor(name)!
    return { name, weightG, caloriesPer100g: r.kcal, proteinPer100g: r.proteinG, carbsPer100g: r.carbsG, fatPer100g: r.fatG }
  }
  const ctx = { userId: USER, mealName: 'Chicken and greens', allergies: [], avoid: [] }
  const target = { calories: 600, proteinG: 45, carbsG: 60, fatG: 15 }
  const noCarb = [fromTable('chicken breast, grilled', 150), fromTable('broccoli', 100), fromTable('olive oil', 10)]

  it('closes a gap the staples can close with no model call', async () => {
    const out = await scaleWithTopUp(noCarb, target, ctx)
    expect(model.calls).toHaveLength(0)
    expect(out.map(i => i.name)).toContain('white rice, cooked')
  })

  it('asks the model exactly once when the staples cannot close it', async () => {
    model.reply = () => ({ ingredients: [guess('crusty bread roll', 80)] })
    await scaleWithTopUp(noCarb, target, { ...ctx, allergies: ['low carb'] })
    expect(model.calls).toHaveLength(1)
  })
})
