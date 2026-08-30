// Q-407 — the meal-plan catalogues as Coach choice sources.
//
// The point is a measurement, not a convenience: a nine-option picker the model typed out cost
// **~554 output tokens**, and output tokens are essentially all of Coach's latency. Six store names
// and thirty-two staples were literals inside `meal-plan-setup-sheet.tsx`, so the Coach had no way
// to offer them except by writing them out.
//
// The property that needed a test rather than a read: **the catalogue sources must not be gated on
// having a training program.** The route returns early with an empty list when there is no active
// program, which is right for `sessions` and wrong for a grocery list — it would make a nutrition
// question fail on a training precondition, for exactly the new user most likely to be asking it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GROCERY_CATALOGUE } from '@trainingai/shared/nutrition/grocery-catalogue'

const repo = vi.hoisted(() => ({
  program: null as unknown,
  restrictions: [] as Record<string, unknown>[],
  getActiveProgram: vi.fn(),
  listDietaryRestrictions: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: async () => ({
    getActiveProgram: repo.getActiveProgram,
    listDietaryRestrictions: repo.listDietaryRestrictions,
    listExerciseLibrary: async () => [],
    listInjuries: async () => [],
  }),
}))

import { GET } from '@/app/api/coach/options/route'

const call = (source: string) =>
  GET(new Request(`http://localhost/api/coach/options?source=${encodeURIComponent(source)}`))

beforeEach(() => {
  repo.getActiveProgram.mockReset().mockResolvedValue(null)
  repo.listDietaryRestrictions.mockReset().mockResolvedValue([])
})

describe('the meal-plan catalogues (Q-407)', () => {
  it('serves each list with no program, and never asks for one', async () => {
    for (const [source, list] of Object.entries(GROCERY_CATALOGUE)) {
      const body = await (await call(source)).json()
      expect(body.options.map((o: { title: string }) => o.title), source).toEqual([...list])
    }
    // The gate below these branches would have returned [] for every one of them.
    expect(repo.getActiveProgram).not.toHaveBeenCalled()
  })

  it('uses the name as the id — these have no row, so the string is the value', async () => {
    const body = await (await call('grocery_stores')).json()
    expect(body.options[0]).toEqual({ id: 'Coles', title: 'Coles' })
  })

  it('serves dietary restrictions from the catalogue, in its own sort order', async () => {
    repo.listDietaryRestrictions.mockResolvedValue([
      { id: 'b', code: 'nuts', label: 'Tree nuts', category: 'allergen', synonyms: [], sortOrder: 2 },
      { id: 'a', code: 'dairy', label: 'Dairy', category: 'allergen', synonyms: [], sortOrder: 1 },
    ])
    const body = await (await call('dietary_restrictions')).json()
    expect(body.options.map((o: { title: string }) => o.title)).toEqual(['Dairy', 'Tree nuts'])
    expect(body.options[0].id).toBe('a')   // a real row id here, unlike the staples above
  })

  // Offering back only what they already avoid would make the picker unable to add anything.
  it('offers the whole catalogue, not the user\'s current selections', async () => {
    repo.listDietaryRestrictions.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({
        id: `r${i}`, code: `c${i}`, label: `R${i}`, category: 'allergen', synonyms: [], sortOrder: i,
      })),
    )
    const body = await (await call('dietary_restrictions')).json()
    // Capped at the same 24 the widget schema allows, so the list cannot exceed what a picker can hold.
    expect(body.options).toHaveLength(24)
  })

  it('still refuses a source it does not serve', async () => {
    expect((await call('groceries')).status).toBe(400)
  })

  // The program-backed sources keep their gate — this is the behaviour the new branches sit above,
  // and moving them must not have moved it.
  it('leaves the program sources returning empty without a program', async () => {
    const body = await (await call('sessions')).json()
    expect(body.options).toEqual([])
    expect(repo.getActiveProgram).toHaveBeenCalled()
  })
})
