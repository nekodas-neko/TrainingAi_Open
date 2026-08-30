// LA-38 — the name a plan gets when the model never sees it.
//
// Deliberately not aesthetic tests. What matters is that the string is a plausible plan NAME (it
// goes straight into `POST /api/nutrition/meal-plans`, whose `name` is capped at 200 chars and is
// what the plan list renders), that it never comes back empty, and that it never grows without
// bound with the meal names — a 6-meal plan of long dish names would otherwise produce a paragraph.
import { describe, it, expect } from 'vitest'
import { planNameFromMeals, restDayCarbLine } from '../plan-naming'

describe('planNameFromMeals', () => {
  it('names a one-meal plan after its meal', () => {
    expect(planNameFromMeals(['Overnight oats'])).toBe('Overnight oats')
  })

  it('joins two and three with "and"', () => {
    expect(planNameFromMeals(['Oats', 'Chilli'])).toBe('Oats and Chilli')
    expect(planNameFromMeals(['Oats', 'Chilli', 'Salmon'])).toBe('Oats, Chilli and Salmon')
  })

  it('counts the tail past three, rather than listing everything', () => {
    expect(planNameFromMeals(['Oats', 'Chilli', 'Salmon', 'Curry'])).toBe('Oats, Chilli and 2 more')
    expect(planNameFromMeals(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('A, B and 4 more')
  })

  // A 6-meal plan of real dish names is where an unbounded join becomes a paragraph in a list row.
  it('stays inside the length cap even with long names', () => {
    const long = [
      'Slow-cooked beef and lentil lasagne with garlic bread',
      'Greek yoghurt with berries, honey and toasted oats',
      'Grilled salmon, sweet potato mash and steamed greens',
    ]
    const name = planNameFromMeals(long)
    expect(name.length).toBeLessThanOrEqual(120)
    expect(name).toContain(long[0])
    expect(name).toContain('2 more')
  })

  it('truncates a single name that is longer than the cap on its own', () => {
    const name = planNameFromMeals(['x'.repeat(400)])
    expect(name.length).toBeLessThanOrEqual(120)
    expect(name.endsWith('…')).toBe(true)
  })

  // The plan's `name` is required (`min(1)`), so an empty result would be a 400 on save.
  it('never returns an empty string', () => {
    for (const input of [[], [''], ['   ', '']]) {
      expect(planNameFromMeals(input)).toBe('Your meal plan')
    }
  })

  it('ignores blank names rather than rendering a gap', () => {
    expect(planNameFromMeals(['Oats', '  ', 'Chilli'])).toBe('Oats and Chilli')
  })
})

describe('restDayCarbLine', () => {
  it('states the shift the code actually applies', () => {
    expect(restDayCarbLine(30)).toBe('About 30 g fewer carbohydrates on a rest day.')
  })

  it('rounds rather than printing the raw product of a fraction', () => {
    expect(restDayCarbLine(200 * 0.15)).toBe('About 30 g fewer carbohydrates on a rest day.')
    expect(restDayCarbLine(29.6)).toBe('About 30 g fewer carbohydrates on a rest day.')
  })

  // A plan with almost no carbohydrate has no rest-day story; "About 0 g fewer" is worse than
  // saying nothing, and the field's own contract already allows "".
  it('says nothing when the shift rounds to nothing', () => {
    expect(restDayCarbLine(0)).toBe('')
    expect(restDayCarbLine(0.4)).toBe('')
  })
})
