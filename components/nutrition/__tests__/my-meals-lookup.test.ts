import { describe, it, expect, vi, afterEach } from 'vitest'
import { lookupTypedMeal } from '../my-meals-lookup'
import type { TypedMeal } from '../my-meals-picker'

const pending: TypedMeal = { text: 'rice', name: 'rice', ingredients: [], looking: true, failed: false, keep: false }

afterEach(() => vi.unstubAllGlobals())

describe('lookupTypedMeal (issue 2890)', () => {
  it('hands up the server sentence when the AI balance is empty, and fails the row', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ error: 'AI features are paused right now.', code: 'ai_paused' }), { status: 503 }))))
    const { meal, paused } = await lookupTypedMeal(pending, null, false)
    expect(paused).toBe('AI features are paused right now.')
    expect(meal).toMatchObject({ looking: false, failed: true })
  })

  it('has no notice for an ordinary failure', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"error":"x"}', { status: 500 }))))
    const { meal, paused } = await lookupTypedMeal(pending, null, false)
    expect(paused).toBeNull()
    expect(meal.failed).toBe(true)
  })

  it('resolves a meal as before', async () => {
    const ing = { name: 'Rice', weightG: 100, caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3 }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ingredients: [ing], name: 'Rice' }), { status: 200 }))))
    const { meal, paused } = await lookupTypedMeal(pending, null, false)
    expect(paused).toBeNull()
    expect(meal).toMatchObject({ failed: false, keep: true, name: 'Rice' })
  })
})
