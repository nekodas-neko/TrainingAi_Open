// BF-11b — the scan route returned one merged meal for every input. A week of meal-prep containers
// or a "5 lunches" roundup page was flattened into a single estimate.
//
// These tests mock the model and pin the ROUTE's handling: the backward-compatible top level, the
// cap, the drop of empty candidates, and the per-candidate serving divide. They deliberately do
// **not** pin the splitting decision itself, which is model behaviour — that lives in
// `splitting-decision.live.test.ts`, which needs a real API key and does not run in CI.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

const USER = '00000000-0000-4000-8000-0000000bf11b'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER, timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateObject: async (_meta: unknown, run: () => Promise<unknown>) => run(),
}))

const modelReply = { current: { identified: true, candidates: [] as unknown[] } }
vi.mock('ai', () => ({ generateObject: vi.fn(async () => ({ object: modelReply.current })) }))

// The URL branch, so the recipeYield divide can be exercised. `fetchPublicUrl` is mocked at the
// module the route imports it from; the page text never reaches a network.
const page = { yield: null as number | null, name: null as string | null }
vi.mock('@/lib/net/safe-fetch', () => ({
  fetchPublicUrl: async () => ({ ok: true, text: '<html>recipe</html>', finalUrl: 'https://example.test/r' }),
}))
vi.mock('@trainingai/shared/nutrition/recipe-parse', () => ({
  extractRecipeJsonLd: () => ({ yield: page.yield, name: page.name, ingredients: ['200g rice'] }),
  extractReadableText: (s: string) => s,
  sliceAroundIngredients: (s: string) => s,
}))

/** 100 g at 200 kcal/100 g, macros that agree with it — so a divide is visible in the calories. */
const candidate = (name: string) => ({
  name, brand: null, confidence: 'high' as const, notes: null,
  fiberG: 4, sugarG: 8, sodiumMg: 400, satFatG: 2,
  ingredients: [{ name, weightG: 100, caloriesPer100g: 200, proteinPer100g: 10, carbsPer100g: 20, fatPer100g: 5 }],
})

type ScanResponse = {
  name?: string; calories?: number; ingredients?: unknown[]; notes?: string
  candidates?: { name: string; calories: number; notes?: string }[]
  error?: string; recipeYield?: number | null
}

// Imported ONCE, in a hook, not inside the first test.
//
// Measured: importing this route takes **4.3 s on an idle machine** — it reaches
// `@/lib/observability`, which pulls in the Drizzle adapter. Paid inside a test it leaves ~700 ms of
// a 5 s budget, so the first case in this file failed at 5012 ms under ordinary parallel load and
// passed on a re-run: a flake this file introduced, in a suite every PR runs. `beforeAll` has its
// own (10 s) budget and pays the cost once, which is both correct attribution and faster.
let POST: (req: Request) => Promise<Response>

beforeAll(async () => {
  ({ POST } = await import('@/app/api/nutrition/scan/route'))
})

async function scan(body: Record<string, unknown>): Promise<ScanResponse> {
  const res = await POST(new Request('http://test/api/nutrition/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
  return res.json()
}

beforeEach(() => {
  modelReply.current = { identified: true, candidates: [] }
  page.yield = null
  page.name = null
})

describe('scan returns candidates (BF-11b)', () => {
  it('keeps the top level as the first dish — five callers read it and two gate on it', async () => {
    modelReply.current = { identified: true, candidates: [candidate('Chicken wrap'), candidate('Bolognese')] }
    const body = await scan({ text: 'lunch and dinner' })

    // `my-meals-picker` reads `body.ingredients`, `ingredient-picker` gates on `scan.calories > 0`.
    // If the top level ever became an array both break silently.
    expect(Array.isArray(body)).toBe(false)
    expect(body.name).toBe('Chicken wrap')
    expect(body.calories).toBe(200)
    expect(body.ingredients).toHaveLength(1)
  })

  it('the top level and candidates[0] cannot disagree — one function builds both', async () => {
    modelReply.current = { identified: true, candidates: [candidate('Chicken wrap'), candidate('Bolognese')] }
    const body = await scan({ text: 'lunch and dinner' })
    const { candidates, sourceUrl, recipeYield, ...top } = body as Record<string, unknown>
    void sourceUrl; void recipeYield
    expect((candidates as unknown[])[0]).toEqual(top)
  })

  it('returns each dish in order, with its own name', async () => {
    modelReply.current = {
      identified: true,
      candidates: ['Tub 1', 'Tub 2', 'Tub 3'].map(candidate),
    }
    const body = await scan({ text: 'three meal-prep tubs' })
    expect(body.candidates?.map(c => c.name)).toEqual(['Tub 1', 'Tub 2', 'Tub 3'])
  })

  it('caps at 8, so a hallucinated 40-way split cannot reach the client', async () => {
    modelReply.current = {
      identified: true,
      candidates: Array.from({ length: 40 }, (_, i) => candidate(`Dish ${i}`)),
    }
    const body = await scan({ text: 'a very long list' })
    expect(body.candidates).toHaveLength(8)
    expect(body.candidates?.[7].name).toBe('Dish 7')
  })

  it('drops a candidate with no ingredients rather than shipping a named zero', async () => {
    // Totals are summed from the ingredient list, so an empty one is 0 kcal under a real name.
    const empty = { ...candidate('Ghost'), ingredients: [] }
    modelReply.current = { identified: true, candidates: [candidate('Real'), empty, candidate('Also real')] }
    const body = await scan({ text: 'two dishes and a ghost' })
    expect(body.candidates?.map(c => c.name)).toEqual(['Real', 'Also real'])
  })

  it('still refuses when nothing was identified', async () => {
    modelReply.current = { identified: false, candidates: [] }
    expect((await scan({ text: 'a photo of a car park' })).error).toBe('Could not identify food')
  })

  it('refuses when every candidate is empty, not just when the list is', async () => {
    modelReply.current = { identified: true, candidates: [{ ...candidate('Ghost'), ingredients: [] }] }
    expect((await scan({ text: 'nothing edible' })).error).toBe('Could not identify food')
  })

  it('divides the stated yield into EVERY candidate, not only the first', async () => {
    // The defect this guards: a per-response divide leaves dishes 2..n at whole-batch calories,
    // which is a 4x overstatement that looks entirely plausible on the card.
    page.yield = 4
    modelReply.current = { identified: true, candidates: [candidate('Curry'), candidate('Salad')] }
    const body = await scan({ url: 'https://example.test/r' })
    expect(body.candidates?.map(c => c.calories)).toEqual([50, 50])
    expect(body.calories).toBe(50)
  })

  it('says the single stated yield was applied to each dish rather than dividing silently', async () => {
    page.yield = 4
    modelReply.current = { identified: true, candidates: [candidate('Curry'), candidate('Salad')] }
    const body = await scan({ url: 'https://example.test/r' })
    for (const c of body.candidates ?? []) {
      expect(c.notes).toContain('Per serving (1 of 4)')
      expect(c.notes).toContain('applied to each')
    }
  })

  it('uses the page name for one dish and the model names for several', async () => {
    page.yield = 1
    page.name = 'Nana’s Sunday Roast'
    modelReply.current = { identified: true, candidates: [candidate('Roast beef')] }
    expect((await scan({ url: 'https://example.test/r' })).name).toBe('Nana’s Sunday Roast')

    // The JSON-LD name describes the PAGE. With several dishes it is not any one of them.
    modelReply.current = { identified: true, candidates: [candidate('Roast beef'), candidate('Trifle')] }
    const many = await scan({ url: 'https://example.test/r' })
    expect(many.name).toBe('Roast beef')
    expect(many.candidates?.map(c => c.name)).toEqual(['Roast beef', 'Trifle'])
  })
})
