import { describe, it, expect, vi, beforeEach } from 'vitest'

const { createFoodItemMock } = vi.hoisted(() => ({ createFoodItemMock: vi.fn() }))
vi.mock('@trainingai/shared/nutrition/create-food-item', () => ({ createFoodItem: createFoodItemMock }))

import { runRecipeImport } from '../recipe-import-run'

function respond(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) })))
}

const ing = (over: Record<string, unknown> = {}) => ({
  name: 'Beef mince', weightG: 500, caloriesPer100g: 217,
  proteinPer100g: 20.1, carbsPer100g: 0, fatPer100g: 15.2, ...over,
})

/**
 * BF-52 lifted this out of `ingredient-picker.tsx`, where it was a closure over component state.
 *
 * **It had no tests, and could not have had any:** exercising it meant rendering a React component,
 * and neither vitest project runs a DOM. Its own comment says the multi-candidate branch, the serial
 * minting, the 0.01 floor and the `recipeYield` refusal *"took two entries to get right"* — four
 * behaviours defended by prose alone. These are them.
 */
describe('runRecipeImport', () => {
  beforeEach(() => {
    createFoodItemMock.mockReset()
    createFoodItemMock.mockImplementation((entry: { name: string }) =>
      Promise.resolve({ id: `item-${entry.name}`, ...entry }))
    vi.unstubAllGlobals()
  })

  it('refuses to invent a yield the page never stated', async () => {
    // **The banana-bread four-fold error.** A page with no stated yield hands up the WHOLE batch;
    // deciding here that it is one serving quarters every macro the user then sees, plausibly.
    respond({ ingredients: [ing()], name: 'Chilli' })
    const out = await runRecipeImport({ url: 'https://x.test/r' }, 'x.test')
    expect(out.kind).toBe('imported')
    if (out.kind !== 'imported') return
    expect(out.recipe.recipeYield).toBeNull()
    expect(out.recipe.name).toBe('Chilli')
  })

  it('carries a stated yield through unchanged', async () => {
    respond({ ingredients: [ing()], recipeYield: 4 })
    const out = await runRecipeImport({ url: 'https://x.test/r' }, 'x.test')
    expect(out.kind === 'imported' && out.recipe.recipeYield).toBe(4)
  })

  it('falls back to the caller’s name only when the response has none', async () => {
    respond({ ingredients: [ing()] })
    const out = await runRecipeImport({ image: 'b64', mimeType: 'image/jpeg' }, 'Recipe')
    expect(out.kind === 'imported' && out.recipe.name).toBe('Recipe')
  })

  it('floors a sub-gram garnish at 0.01 instead of rounding it out of the meal', async () => {
    // `ingredientToEntry` returns `Math.round(weightG) / 100`, so anything under **0.5 g** comes back
    // as exactly 0 and the ingredient is in the recipe with no weight at all — present in the list,
    // contributing nothing to the macros.
    //
    // **0.4, not 0.5, and the difference is the whole test.** At 0.5 g `Math.round` gives 1, so the
    // conversion already returns 0.01 and `Math.max(0.01, …)` is a no-op — which is what this
    // assertion originally used, and it passed with the floor deleted. Caught by mutating it.
    respond({ ingredients: [ing({ name: 'Salt', weightG: 0.4 })] })
    const out = await runRecipeImport({ url: 'https://x.test/r' }, 'x.test')
    expect(out.kind === 'imported' && out.recipe.entries[0].qty).toBe(0.01)
  })

  it('asks which dish rather than silently taking the first', async () => {
    // A multi-dish page: `candidates[0]` is the top level, so importing it and stopping would drop
    // the rest of the page without saying so. Nothing is minted before the question is asked.
    respond({
      ingredients: [ing()],
      candidates: [
        { name: 'Loaf', ingredients: [ing()] },
        { name: 'Icing', ingredients: [ing({ name: 'Sugar' })] },
      ],
    })
    const out = await runRecipeImport({ url: 'https://x.test/r' }, 'x.test')
    expect(out.kind).toBe('candidates')
    expect(createFoodItemMock, 'nothing may be minted before the user picks').not.toHaveBeenCalled()
  })

  it('ignores a candidate with no ingredients, so one real dish still imports', async () => {
    respond({ ingredients: [ing()], candidates: [{ name: 'Loaf', ingredients: [ing()] }, { name: 'Note' }] })
    const out = await runRecipeImport({ url: 'https://x.test/r' }, 'x.test')
    expect(out.kind).toBe('imported')
  })

  it('mints ingredients serially, against one local table', async () => {
    respond({ ingredients: [ing(), ing({ name: 'Pasta' }), ing({ name: 'Passata' })] })
    const out = await runRecipeImport({ text: 'chilli' }, 'chilli', 'u1')
    expect(out.kind === 'imported' && out.recipe.entries).toHaveLength(3)
    expect(createFoodItemMock).toHaveBeenCalledTimes(3)
    // The user id has to reach the mint, or every ingredient of an imported recipe is created
    // unscoped and the local dedup cannot see the caller's own library.
    expect(createFoodItemMock.mock.calls[0][1]).toBe('u1')
  })

  it('reports an empty result rather than an error, because they read differently', async () => {
    // "No recipe could be read from that page" sends you to try another page; "could not read that
    // recipe" sends you to check your connection. The caller picks the message from this.
    respond({ ingredients: [] })
    expect((await runRecipeImport({ url: 'https://x.test/r' }, 'x.test')).kind).toBe('empty')
    respond({}, false)
    expect((await runRecipeImport({ url: 'https://x.test/r' }, 'x.test')).kind).toBe('empty')
  })

  it('never throws — a network failure is an outcome', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    expect((await runRecipeImport({ url: 'https://x.test/r' }, 'x.test')).kind).toBe('error')
  })

  it('passes the payload through whole, since the route branches on its keys', async () => {
    respond({ ingredients: [ing()] })
    await runRecipeImport({ image: 'b64', mimeType: 'image/png', imageKind: 'recipe' }, 'Recipe')
    const body = JSON.parse((globalThis.fetch as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0][1].body)
    // `imageKind: 'recipe'` is the entire difference between reading a written ingredient list and
    // estimating a finished plate from a photograph.
    expect(body).toEqual({ image: 'b64', mimeType: 'image/png', imageKind: 'recipe' })
  })
})
