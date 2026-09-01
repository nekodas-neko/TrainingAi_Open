import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { rescaleRemaining, remainingMeals, MEAL_FLOOR_KCAL } from '../plan-rescale'
import type { MealPlanMeal } from '@trainingai/shared/types/nutrition'

/**
 * Q-187's second half — the day recalculates against what was actually eaten.
 *
 * The entry names three questions and says getting any of them wrong makes the plan **worse than a
 * static one**, which is what these cases are aimed at: the spread must actually reach every
 * remaining meal, the floor must stop an inedible suggestion being printed, and none of it may
 * touch a day that is not today.
 */

function meal(position: number, kcal: number, over: Partial<MealPlanMeal> = {}): MealPlanMeal {
  return {
    id: `m${position}`,
    variantId: 'v1',
    mealTypeId: null,
    savedMealId: null,
    position,
    name: `Meal ${position}`,
    notes: null,
    targetCalories: kcal,
    // A 30/40/30 split by calories, so a scaled meal's macros can be checked against its own factor.
    targetProteinG: (kcal * 0.3) / 4,
    targetCarbsG: (kcal * 0.4) / 4,
    targetFatG: (kcal * 0.3) / 9,
    ingredients: [{ name: 'x', weightG: 100, calories: kcal, proteinG: 0, carbsG: 0, fatG: 0 }],
    suggestedTime: null,
    ...over,
  } as MealPlanMeal
}

const MEALS = [meal(1, 600), meal(2, 700), meal(3, 700)]      // 2,000 kcal planned
const TARGET = { calories: 2000, proteinG: 150, carbsG: 200, fatG: 67 }
const BASE = {
  meals: MEALS,
  target: TARGET,
  loggedPositions: new Set<number>(),
  declinedMealIds: new Set<string>(),
  isToday: true,
}

describe('the spread', () => {
  it('gives every remaining meal a share of a lunch overshoot', () => {
    // Meal 1 eaten at 900 against a planned 600. 1,100 kcal left over a 1,400 kcal plan → 0.7857.
    const r = rescaleRemaining({ ...BASE, eaten: { ...TARGET, calories: 900 }, loggedPositions: new Set([1]) })!
    expect(r.byPosition.get(2)!.calories).toBe(550)
    expect(r.byPosition.get(3)!.calories).toBe(550)
    expect(r.byPosition.get(2)!.calories + r.byPosition.get(3)!.calories).toBe(1100)
    // The eaten meal is not re-scaled: it is food, not a suggestion.
    expect(r.byPosition.has(1)).toBe(false)
    expect(r.note).toBeNull()
  })

  it('scales up when the day is under, which is the "or vice versa" half of the request', () => {
    const r = rescaleRemaining({ ...BASE, eaten: { ...TARGET, calories: 200 }, loggedPositions: new Set([1]) })!
    expect(r.byPosition.get(2)!.calories).toBeGreaterThan(700)
    expect(r.byPosition.get(3)!.calories).toBeGreaterThan(700)
  })

  it('keeps each meal\'s macro split rather than rewriting its shape', () => {
    const r = rescaleRemaining({ ...BASE, eaten: { ...TARGET, calories: 900 }, loggedPositions: new Set([1]) })!
    const m2 = r.byPosition.get(2)!
    // 700 → 550 is 0.7857; the macros must ride the same factor, not their own remaining budgets.
    expect(m2.proteinG).toBe(Math.round((700 * 0.3 / 4) * (1100 / 1400)))
    expect(m2.carbsG).toBe(Math.round((700 * 0.4 / 4) * (1100 / 1400)))
    expect(m2.fatG).toBe(Math.round((700 * 0.3 / 9) * (1100 / 1400)))
  })
})

describe('the floor', () => {
  it('leaves a meal as planned rather than printing an inedible number', () => {
    // 1,850 eaten of 2,000. 150 kcal over two meals is 75 and 75 — both under the floor.
    const r = rescaleRemaining({ ...BASE, eaten: { ...TARGET, calories: 1850 }, loggedPositions: new Set([1]) })!
    expect(r.byPosition.size).toBe(0)
    expect(r.flooredCount).toBe(2)
    expect(r.note).toMatch(/left as planned/)
  })

  it('says the day is over budget when nothing is left', () => {
    const r = rescaleRemaining({ ...BASE, eaten: { ...TARGET, calories: 2400 }, loggedPositions: new Set([1]) })!
    expect(r.byPosition.size).toBe(0)
    expect(r.note).toMatch(/400 kcal past today's target/)
  })

  it('floors only the meals that need it, and names how many', () => {
    // Remaining 1,200 and 300 planned, 400 kcal of budget → 320 and 80. One clears the floor.
    const r = rescaleRemaining({
      ...BASE,
      meals: [meal(1, 500), meal(2, 1200), meal(3, 300)],
      eaten: { ...TARGET, calories: 1600 },
      loggedPositions: new Set([1]),
    })!
    expect(r.byPosition.has(2)).toBe(true)
    expect(r.byPosition.get(2)!.calories).toBeGreaterThanOrEqual(MEAL_FLOOR_KCAL)
    expect(r.byPosition.has(3)).toBe(false)
    expect(r.flooredCount).toBe(1)
    expect(r.note).toMatch(/1 of the remaining 2 meals/)
  })
})

describe('when it must say nothing at all', () => {
  it.each([
    ['a day with no logs', { eaten: undefined }],
    ['a past or future day', { eaten: { ...TARGET, calories: 900 }, isToday: false }],
    ['every meal eaten', { eaten: { ...TARGET, calories: 900 }, loggedPositions: new Set([1, 2, 3]) }],
    ['every remaining meal declined', { eaten: { ...TARGET, calories: 900 }, declinedMealIds: new Set(['m1', 'm2', 'm3']) }],
  ])('%s', (_label, patch) => {
    expect(rescaleRemaining({ ...BASE, ...patch } as Parameters<typeof rescaleRemaining>[0])).toBeNull()
  })
})

describe('remainingMeals is the complement of fillableMeals, not the same set', () => {
  it('keeps a meal whose time has already passed but which was never logged', () => {
    // The entry claimed fillableMeals "already answers which meals are still ahead of you". It
    // answers the opposite — meals whose hour has COME and which are not yet logged — so using it
    // here would drop a skipped lunch out of the remaining budget and hand its calories to dinner.
    const left = remainingMeals(MEALS, new Set([1]), new Set())
    expect(left.map(m => m.position)).toEqual([2, 3])
  })

  it('drops declined meals, because their calories genuinely are not coming', () => {
    expect(remainingMeals(MEALS, new Set(), new Set(['m2'])).map(m => m.position)).toEqual([1, 3])
  })
})

describe('nothing here writes', () => {
  it('the module cannot log, fetch or store', () => {
    // The prefill's property is that nothing enters food_logs unconfirmed. A re-scale changes what
    // is SUGGESTED; the entry is explicit that mixing the two reintroduces the illegal state.
    const src = readFileSync(path.join(path.resolve(__dirname, '../../..'), 'components/nutrition/plan-rescale.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    for (const forbidden of ['fetch(', 'queueMutation', 'upsert', 'localStorage', 'setCached']) {
      expect(src, `plan-rescale must not ${forbidden}`).not.toContain(forbidden)
    }
  })
})

/**
 * The module being right is half of it. A correct re-scale the card never calls, or one passed as a
 * fresh object into a `memo`ed row inside a `.map()`, is a feature that does not reach the screen.
 */
const ROOT = path.resolve(__dirname, '../../..')
const source = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('the card is wired to it', () => {
  it('computes the re-scale and gates it on the day being today', () => {
    const src = source('components/nutrition/meal-plan-section.tsx')
    // Anchored on the assignment, not on the call appearing anywhere. `/rescaleRemaining\(\{/`
    // alone was the first version and it survived `const rescale = null && rescaleRemaining({…})`
    // — the text is still there while the feature is dead, which is the shape of guard that reads
    // as coverage and is not.
    expect(src).toMatch(/const rescale = rescaleRemaining\(\{/)
    expect(src).toMatch(/isToday:\s*logDate != null && today != null && logDate === today/)
  })

  it('renders the floor sentence', () => {
    expect(source('components/nutrition/meal-plan-section.tsx')).toMatch(/rescale\?\.note/)
  })

  it('passes the adjusted figures as four scalars, never one object', () => {
    // `PlanMealRow` is memo'ed and rendered in a `.map()`, where a hook is not allowed and an
    // object literal is re-created every render — which defeats the memo silently and leaves the
    // component still wearing its wrapper. Scalars are the `meal-macro-bars.tsx` pattern.
    const src = source('components/nutrition/meal-plan-section.tsx')
    for (const prop of ['adjustedCalories', 'adjustedProteinG', 'adjustedCarbsG', 'adjustedFatG']) {
      expect(src, `${prop} must be passed`).toContain(`${prop}={rescale?.byPosition.get(meal.position)?.`)
    }
    expect(src, 'no object literal may be passed as an adjusted prop').not.toMatch(/adjusted=\{\{/)
  })
})
