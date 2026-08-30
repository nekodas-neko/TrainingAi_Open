// LB-21 — `useLibrary` is reachable from the wizard and no test has ever run a generation with it on.
//
// `selectLibraryMeals` itself is well covered in `library-match.test.ts` — ranking, eligibility
// windows, untagged-suits-any-slot, no-meal-twice. **The route WIRING was not**: `grep -rl
// useLibrary --include=*.test.ts` returned nothing. BF-11g shipped the flag with no test and BF-11h
// made it settable, and between them nobody had run a generation with it on. What the shared tests
// structurally cannot see is everything below — the conditional fetches, the slot arithmetic that
// places a pick, the two fields BF-11h's review step reads, and the pin filter.
//
// **The entry's suggested shape does not hold, and this is the correction.** It says *"a fully-pinned
// or fully-library-filled request generates nothing, which is what makes an end-to-end test of this
// flag cheap and deterministic"*. It does not: the route calls the model **unconditionally**, before
// it knows how many meals it needs, because `planName` and `restDayAdjustment` come from that same
// call. So the model is mocked here — the same way `app/api/nutrition/scan/__tests__` mocks it — and
// one case below pins that call happening on a plan with nothing to generate, so the cost is a
// recorded fact rather than a surprise. Filed as **LA-38**.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

const USER = '00000000-0000-4000-8000-000000001b21'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER, timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  contentKey: (...parts: unknown[]) => parts.join('|'),
  loggedGenerateObject: async (_meta: unknown, run: () => Promise<unknown>) => run(),
}))

/** What the model returns, and how many times it was asked. */
const model = { meals: [] as unknown[], calls: 0, prompts: [] as string[] }
vi.mock('ai', () => ({
  generateObject: vi.fn(async (opts: { prompt: string }) => {
    model.calls++
    model.prompts.push(opts.prompt)
    return { object: { planName: 'Test plan', meals: model.meals, restDayAdjustment: '' } }
  }),
}))

// Portioning is not what this file is about, and its own top-up path makes a second model call.
// Identity keeps every assertion below about WIRING — which meal landed in which slot, and what the
// route said about it — rather than about arithmetic `meal-split` already owns.
vi.mock('@/lib/nutrition/meal-top-up', () => ({
  scaleWithTopUp: async (ingredients: unknown[]) => ingredients,
}))

vi.mock('@/lib/health/energy-balance-service', () => ({
  computeEnergyBalance: async () => ({ target: { recommendedKcal: 2000 } }),
}))

const MEAL_TYPE_BREAKFAST = '00000000-0000-4000-8000-00000000a701'
const MEAL_TYPE_DINNER = '00000000-0000-4000-8000-00000000a702'

/**
 * A saved meal that resizes ONTO any slot of the 2000/150/200/67 day below.
 *
 * Three near-pure ingredients, one per macro, because `scaleIngredientsToTargets` moves each macro
 * GROUP independently and counts only that group's own contribution: a chicken-rice-oil version of
 * this fixture lands protein and carbs exactly and comes out **45.8 g fat against a 22.4 g target**,
 * because the fat the chicken and rice carry is invisible to the fat group's scale. That is the
 * scaler working as designed and it is why the fixture is pure — the match has to be decided by the
 * route's wiring, not by how far a realistic meal happens to drift.
 *
 * `mealFit` gates the PORTIONED meal, so shape decides a match and size does not.
 */
const libraryMeal = (id: string, name: string, mealTypeIds: string[] = []) => ({
  id, name, mealTypeIds, servings: 1,
  items: [
    { quantityMultiplier: 0.5, foodItem: { name: 'Whey isolate', brand: null, servingSizeG: 100, calories: 400, proteinG: 100, carbsG: 0, fatG: 0 } },
    { quantityMultiplier: 0.6, foodItem: { name: 'Dextrose', brand: null, servingSizeG: 100, calories: 400, proteinG: 0, carbsG: 100, fatG: 0 } },
    { quantityMultiplier: 0.2, foodItem: { name: 'Olive oil', brand: null, servingSizeG: 100, calories: 900, proteinG: 0, carbsG: 0, fatG: 100 } },
  ],
})

const repo = {
  getNutritionTargets: vi.fn(async () => ({ calories: 2000, proteinG: 150, carbsG: 200, fatG: 67 })),
  listUserDietaryRestrictions: vi.fn(async () => []),
  getMostRecentConfirmedWeightKg: vi.fn(async () => 72),
  listSavedMeals: vi.fn(async () => [] as unknown[]),
  listMealTypes: vi.fn(async () => [] as unknown[]),
}
vi.mock('@/lib/data', () => ({ getRepository: async () => repo, getRepositoryAsync: async () => repo }))

type Meal = { position: number; name: string; source: 'kept' | 'library' | 'ai'; matchReason: string | null; savedMealId: string | null }
type PlanResponse = {
  planName: string; libraryMatchCount: number; droppedPins: string[]
  variants: { dayType: string; meals: Meal[] }[]
  error?: string
}

let POST: (req: Request) => Promise<Response>
beforeAll(async () => { ({ POST } = await import('@/app/api/nutrition/meal-plans/generate/route')) })

const generate = async (body: Record<string, unknown>): Promise<PlanResponse> => {
  const res = await POST(new Request('http://x/api/nutrition/meal-plans/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  return res.json()
}

/** Whatever the model is asked for, so a slot the library did not fill still comes back named. */
const aiMeals = (n: number) => Array.from({ length: n }, (_, i) => ({
  name: `AI meal ${i + 1}`, notes: '',
  ingredients: [{ name: 'Chicken', weightG: 200, caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6 }],
}))

beforeEach(() => {
  vi.clearAllMocks()
  model.calls = 0; model.prompts = []; model.meals = aiMeals(6)
  repo.listSavedMeals.mockResolvedValue([])
  repo.listMealTypes.mockResolvedValue([])
})

describe('useLibrary off — the common path pays nothing for a feature it is not using', () => {
  it('skips BOTH library reads', async () => {
    await generate({ mealCount: 3 })
    expect(repo.listSavedMeals).not.toHaveBeenCalled()
    expect(repo.listMealTypes).not.toHaveBeenCalled()
  })

  // A regression here is invisible except as latency, which is why it is asserted rather than
  // trusted: the conditional is the only reason the common path costs nothing.
  it('still reads the library when meals are PINNED, because pins need it', async () => {
    repo.listSavedMeals.mockResolvedValue([libraryMeal(MEAL_A, 'Oats')])
    await generate({ mealCount: 3, keepSavedMealIds: [MEAL_A] })
    expect(repo.listSavedMeals).toHaveBeenCalledTimes(1)
    expect(repo.listMealTypes).not.toHaveBeenCalled()   // only the library pass needs the windows
  })

  // Silence and "nothing fitted" are different answers, and BF-11h's review step reads this field
  // to tell them apart. Null is how it says the library had no say.
  it('leaves matchReason null on every slot', async () => {
    const plan = await generate({ mealCount: 3 })
    expect(plan.libraryMatchCount).toBe(0)
    expect(plan.variants[0].meals.map(m => m.matchReason)).toEqual([null, null, null])
    expect(plan.variants[0].meals.every(m => m.source === 'ai')).toBe(true)
  })
})

const MEAL_A = '00000000-0000-4000-8000-0000000000a1'
const MEAL_B = '00000000-0000-4000-8000-0000000000b1'
const MEAL_C = '00000000-0000-4000-8000-0000000000c1'

describe('useLibrary on', () => {
  it('reads both the library and the meal-type windows', async () => {
    repo.listSavedMeals.mockResolvedValue([libraryMeal(MEAL_A, 'Oats')])
    await generate({ mealCount: 3, useLibrary: true })
    expect(repo.listSavedMeals).toHaveBeenCalledTimes(1)
    expect(repo.listMealTypes).toHaveBeenCalledTimes(1)
  })

  it('fills slots from the library and counts what it used', async () => {
    repo.listSavedMeals.mockResolvedValue([libraryMeal(MEAL_A, 'Oats'), libraryMeal(MEAL_B, 'Chilli')])
    const plan = await generate({ mealCount: 3, useLibrary: true })

    expect(plan.libraryMatchCount).toBe(2)
    const fromLibrary = plan.variants[0].meals.filter(m => m.source === 'library')
    expect(fromLibrary.map(m => m.name)).toEqual(['Oats', 'Chilli'])
    // libraryMatchCount is what the review step renders instead of counting; the two must agree.
    expect(fromLibrary).toHaveLength(plan.libraryMatchCount)
  })

  // The arithmetic nothing checked: a pick is matched against slot `kept.length + i` and has to
  // land THERE, after the pinned meals, not at the head of the list.
  it('places picks after the pinned meals, at the slot they were matched against', async () => {
    repo.listSavedMeals.mockResolvedValue([
      libraryMeal(MEAL_A, 'Pinned'), libraryMeal(MEAL_B, 'Library'),
    ])
    const plan = await generate({ mealCount: 3, useLibrary: true, keepSavedMealIds: [MEAL_A] })

    const meals = plan.variants[0].meals
    expect(meals.map(m => m.position)).toEqual([0, 1, 2])
    expect(meals[0]).toMatchObject({ name: 'Pinned', source: 'kept', matchReason: null })
    expect(meals[1]).toMatchObject({ name: 'Library', source: 'library' })
    expect(meals[1].matchReason).toMatch(/from your library/i)
  })

  // A pinned meal is already in the plan; offering it again is the duplicate the pass exists to
  // avoid, one source earlier than the model's "genuinely DIFFERENT food" instruction.
  it('never offers a pinned meal back through the library', async () => {
    repo.listSavedMeals.mockResolvedValue([libraryMeal(MEAL_A, 'Only meal')])
    const plan = await generate({ mealCount: 3, useLibrary: true, keepSavedMealIds: [MEAL_A] })

    expect(plan.libraryMatchCount).toBe(0)
    expect(plan.variants[0].meals.filter(m => m.name === 'Only meal')).toHaveLength(1)
  })

  it('says the library was searched on a slot it could not fill', async () => {
    // Nothing in the library resizes onto a slot: a fat-only meal has no protein or carb source,
    // and no portioning can give it one.
    repo.listSavedMeals.mockResolvedValue([{
      id: MEAL_C, name: 'Olive oil', mealTypeIds: [], servings: 1,
      items: [{ quantityMultiplier: 1, foodItem: { name: 'Olive oil', brand: null, servingSizeG: 100, calories: 884, proteinG: 0, carbsG: 0, fatG: 100 } }],
    }])
    const plan = await generate({ mealCount: 3, useLibrary: true })

    expect(plan.libraryMatchCount).toBe(0)
    // Not null — the difference between "we looked and nothing fitted" and "we never looked".
    expect(plan.variants[0].meals.map(m => m.matchReason))
      .toEqual(Array(3).fill('No saved meal fitted this slot.'))
  })

  // Tagging is the shared module's rule; that the route THREADS the windows into it is not, and a
  // route that passed `[]` here would still fill slots — just the wrong ones. A 3-meal day splits
  // to 07:00 / 14:00 / 21:00, so only the first slot is inside the breakfast window.
  it('passes the meal-type windows through, so a tagged meal is confined to its slot', async () => {
    repo.listMealTypes.mockResolvedValue([
      { id: MEAL_TYPE_BREAKFAST, timeStartHour: 5, timeEndHour: 10 },
      { id: MEAL_TYPE_DINNER, timeStartHour: 17, timeEndHour: 22 },
    ])
    repo.listSavedMeals.mockResolvedValue([libraryMeal(MEAL_A, 'Breakfast only', [MEAL_TYPE_BREAKFAST])])

    const plan = await generate({ mealCount: 3, useLibrary: true })
    const picked = plan.variants[0].meals.filter(m => m.source === 'library')
    expect(picked).toHaveLength(1)
    expect(picked[0].position).toBe(0)
    expect(plan.variants[0].meals[0].name).toBe('Breakfast only')
  })

  // The same fixture with a window it cannot reach — the half that shows the windows are being
  // APPLIED rather than merely passed. Untagged would have filled all three.
  it('leaves every slot to the model when the tag matches no slot', async () => {
    repo.listMealTypes.mockResolvedValue([{ id: MEAL_TYPE_DINNER, timeStartHour: 2, timeEndHour: 4 }])
    repo.listSavedMeals.mockResolvedValue([libraryMeal(MEAL_A, 'Middle of the night', [MEAL_TYPE_DINNER])])

    const plan = await generate({ mealCount: 3, useLibrary: true })
    expect(plan.libraryMatchCount).toBe(0)
  })

  it('tells the model what the library already took, so it does not repeat it', async () => {
    repo.listSavedMeals.mockResolvedValue([libraryMeal(MEAL_A, 'Oats')])
    await generate({ mealCount: 3, useLibrary: true })
    expect(model.prompts[0]).toContain('Oats')
    expect(model.prompts[0]).toMatch(/ALREADY contains these meals/)
  })
})

// LA-38, pinned rather than fixed here: the call is unconditional because the plan's NAME comes out
// of it. That is a real cost on a plan with nothing to generate, and it is the assumption the entry
// that asked for this file made in the other direction — so it is recorded as behaviour rather than
// left for the next reader to re-derive.
describe('a plan the library filled entirely still calls the model, for its name', () => {
  it('asks for zero meals rather than skipping the call', async () => {
    repo.listSavedMeals.mockResolvedValue([
      libraryMeal(MEAL_A, 'One'), libraryMeal(MEAL_B, 'Two'), libraryMeal(MEAL_C, 'Three'),
    ])
    const plan = await generate({ mealCount: 3, useLibrary: true })

    expect(plan.libraryMatchCount).toBe(3)
    expect(model.calls).toBe(1)
    expect(model.prompts[0]).toContain('Meals: exactly 0.')
    expect(plan.planName).toBe('Test plan')
  })
})
