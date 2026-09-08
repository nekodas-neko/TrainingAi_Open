/**
 * PS-39 — two more of the twelve #956 exposed as believed-tested-and-not.
 *
 * `saved-meals/[id]` carries RV-45: a delete that matched no row was reported as one that removed
 * something, and the sheets calling it do `if (!res.ok) throw` — so a refused cross-account delete,
 * or a stale id, **confirmed itself to the user** and the row came back on the next pull.
 *
 * `meal-plans/generate/meal` carries the one that would matter most if it broke: **dietary
 * restrictions are read from the database, never from the request.** A client that omitted them
 * would silently get a meal built without an allergy the user has recorded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const updateSavedMeal = vi.fn(async (..._a: unknown[]) => ({ id: 'm1' }) as unknown)
const deleteSavedMeal = vi.fn(async (_id: string, _userId: string) => false)
const listUserDietaryRestrictions = vi.fn(async (_userId: string) =>
  [] as Array<{ label: string; severity: string }>)
/** Typed loosely on purpose: a model returns arbitrary JSON and the schema is what narrows it, so
 *  a case that hands back an extra key — a total it was told not to output — has to be expressible
 *  here. Inferring the type from the happy-path default makes that case a compile error instead. */
const generateObject = vi.fn(async (_o: unknown) => ({ object: {
  name: 'Chicken and rice', notes: 'quick', ingredients: [
    { name: 'chicken breast', weightG: 200, caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6 },
  ],
} as Record<string, unknown> }))
const scaleWithTopUp = vi.fn(async (ing: unknown[]) => ing)

let sessionUser: { id: string } | null = { id: 'u-1' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({ updateSavedMeal, deleteSavedMeal, listUserDietaryRestrictions }),
  getRepositoryAsync: async () => ({ updateSavedMeal, deleteSavedMeal, listUserDietaryRestrictions }),
}))
vi.mock('ai', () => ({ generateObject: (o: unknown) => generateObject(o) }))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  contentKey: (...p: unknown[]) => p.join('|'),
  loggedGenerateObject: async (_m: unknown, run: () => Promise<unknown>) => run(),
}))
vi.mock('@/lib/nutrition/meal-top-up', () => ({ scaleWithTopUp: (i: unknown[]) => scaleWithTopUp(i) }))

import { PUT as putSavedMeal, DELETE as deleteSavedMealRoute } from '@/app/api/nutrition/saved-meals/[id]/route'
import { POST as generateMeal } from '@/app/api/nutrition/meal-plans/generate/meal/route'

const UUID = '00000000-0000-4000-8000-000000000001'
let seq = 0
const freshUser = () => { sessionUser = { id: `u-${++seq}` } }

const del = (id: string) =>
  deleteSavedMealRoute(new Request('http://localhost/x', { method: 'DELETE' }) as never,
                       { params: Promise.resolve({ id }) } as never)
const put = (id: string, body: unknown) =>
  putSavedMeal(new Request('http://localhost/x', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as never, { params: Promise.resolve({ id }) } as never)

const gen = (body: unknown) =>
  generateMeal(new Request('http://localhost/x', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as never)

const targets = { targetCalories: 600, targetProteinG: 40, targetCarbsG: 60, targetFatG: 20 }
const promptOf = () => (generateObject.mock.calls[0][0] as { prompt: string }).prompt

beforeEach(() => {
  for (const m of [updateSavedMeal, deleteSavedMeal, listUserDietaryRestrictions, generateObject, scaleWithTopUp]) m.mockClear()
  deleteSavedMeal.mockResolvedValue(false)
  listUserDietaryRestrictions.mockResolvedValue([])
  scaleWithTopUp.mockImplementation(async (i: unknown[]) => i)
  generateObject.mockResolvedValue({ object: {
    name: 'Chicken and rice', notes: 'quick', ingredients: [
      { name: 'chicken breast', weightG: 200, caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6 },
    ],
  } })
  freshUser()
})

describe('DELETE /api/nutrition/saved-meals/[id]', () => {
  it('404s a delete that matched no row instead of confirming it (RV-45)', async () => {
    // The sheets do `if (!res.ok) throw`, so a `{ success: true }` here makes a refused
    // cross-account delete look done — and the row returns on the next pull.
    deleteSavedMeal.mockResolvedValue(false)
    expect((await del(UUID)).status).toBe(404)

    deleteSavedMeal.mockResolvedValue(true)
    const ok = await del(UUID)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ success: true })
  })

  it('scopes the delete to the caller, so an id alone is never enough', async () => {
    deleteSavedMeal.mockResolvedValue(true)
    await del(UUID)
    expect(deleteSavedMeal).toHaveBeenCalledWith(UUID, sessionUser!.id)
  })

  it('refuses a malformed id and no session, without reaching the repository', async () => {
    expect((await del('not-a-uuid')).status).toBe(400)
    sessionUser = null
    expect((await del(UUID)).status).toBe(401)
    expect(deleteSavedMeal).not.toHaveBeenCalled()
  })
})

describe('PUT /api/nutrition/saved-meals/[id]', () => {
  it('413s a body over the cap rather than truncating it (Q-396 raised this to 64 KB)', async () => {
    // A capped thumbnail is ~21.3 KB of base64 plus the items; 32 KB rejected legitimate
    // max-size images with a 413 that looked like an upload bug. Over 64 KB is still refused.
    const huge = { name: 'x', items: [], servings: 1, imageDataUri: 'd'.repeat(70 * 1024) }
    expect((await put(UUID, huge)).status).toBe(413)
    expect(updateSavedMeal).not.toHaveBeenCalled()
  })

  it('refuses a servings value that would make a portion infinite', async () => {
    // `servings` divides, so a zero is not a small mistake — it is an infinite portion. Bounded
    // 0.25–50 for that reason, not for tidiness.
    for (const servings of [0, -1, 51]) {
      updateSavedMeal.mockClear()
      expect((await put(UUID, { name: 'x', servings })).status, `servings ${servings}`).toBe(400)
      expect(updateSavedMeal).not.toHaveBeenCalled()
    }
  })

  it('keeps OMITTED and explicit-null apart for the image and the tags', async () => {
    // The distinction the schema exists to carry: omitted means "the caller did not mention it"
    // and must leave a stored value alone, while an explicit null clears it. Collapsing them —
    // a `.default([])` on mealTypeIds, say — turns "did not mention tags" into "clear the tags",
    // and every save from the saved-meals sheet omits them until BF-11f ships a picker.
    updateSavedMeal.mockResolvedValue({ id: 'm1' })

    await put(UUID, { name: 'x' })
    const [, , , , , omittedImage, omittedTags] = updateSavedMeal.mock.calls[0]
    expect(omittedImage).toBeUndefined()
    expect(omittedTags).toBeUndefined()

    updateSavedMeal.mockClear()
    await put(UUID, { name: 'x', imageDataUri: null, mealTypeIds: [] })
    const [, , , , , clearedImage, clearedTags] = updateSavedMeal.mock.calls[0]
    expect(clearedImage).toBeNull()
    expect(clearedTags).toEqual([])
  })
})

describe('POST /api/nutrition/meal-plans/generate/meal', () => {
  it('takes allergies from the DATABASE, never from the request', async () => {
    // The invariant with real consequences: a client that omitted them would get a meal built
    // without an allergy the user has recorded.
    listUserDietaryRestrictions.mockResolvedValue([
      { label: 'peanuts', severity: 'allergy' },
      { label: 'coriander', severity: 'avoid' },
    ])
    await gen(targets)

    const prompt = promptOf()
    expect(prompt).toContain('MUST NOT CONTAIN (allergy)')
    expect(prompt).toContain('peanuts')
    expect(prompt).toContain('coriander')
    expect(listUserDietaryRestrictions).toHaveBeenCalledWith(sessionUser!.id)
  })

  it('rewrites only when it has BOTH an instruction and a meal to apply it to', async () => {
    // An instruction with nothing to apply it to is a fresh generation wearing the wrong prompt.
    await gen({ ...targets, instruction: 'make it vegetarian' })
    expect(promptOf()).toContain('Design ONE meal')

    generateObject.mockClear()
    await gen({ ...targets, instruction: 'make it vegetarian',
      currentMeal: { name: 'Beef stew', ingredients: [] } })
    expect(promptOf()).toContain('REWRITE the meal below')
  })

  it('says "could not suggest" on a fresh generation and "could not apply" on a rewrite (PS-37)', async () => {
    // The else branch used to say "Could not rewrite that meal" on a fresh generation — the one
    // thing the user had not asked for.
    generateObject.mockRejectedValue(new Error('model down'))
    const fresh = await gen(targets)
    expect(fresh.status).toBe(502)
    expect((await fresh.json()).error).toMatch(/could not suggest a meal/i)

    const rewrite = await gen({ ...targets, instruction: 'less fat',
      currentMeal: { name: 'Beef stew', ingredients: [] } })
    expect((await rewrite.json()).error).toMatch(/could not apply that change/i)
  })

  it('sums the totals in code and never takes one from the model', async () => {
    // The model states per-100g reference values; every total is summed by `sumIngredients`, so a
    // model that invents a total cannot move the day's numbers.
    generateObject.mockResolvedValue({ object: {
      name: 'M', notes: '', totalCalories: 99999,
      ingredients: [{ name: 'rice', weightG: 100, caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3 }],
    } })
    const json = await (await gen(targets)).json()
    expect(json.actual.calories).toBeCloseTo(130, 0)
    expect(JSON.stringify(json)).not.toContain('99999')
  })

  it('fences the user\'s own text as data, and is never served from a cache', async () => {
    await gen({ ...targets, stores: ['Coles'], excludedFoods: ['olives'] })
    expect(promptOf()).toContain('<user_text>')
    const res = await gen(targets)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('refuses without a session, before spending a model call', async () => {
    sessionUser = null
    expect((await gen(targets)).status).toBe(401)
    expect(generateObject).not.toHaveBeenCalled()
  })
})
