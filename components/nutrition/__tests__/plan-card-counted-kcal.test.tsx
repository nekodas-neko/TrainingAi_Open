import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MealPlan } from '@trainingai/shared/types/nutrition'
import { MealPlanSection } from '../meal-plan-section'
import { planCardEatenKcal } from '../plan-card-kcal'

/**
 * #2921. The Active Plan card printed the day's logged calories (600) while the ring above it read
 * logged plus counted estimates (1,250). The card now reads `countedIntakeKcal`; the macro bars stay
 * logged-only because an estimate has no trustworthy macros.
 */
const DINNER = 'type-dinner'
const LUNCH = 'type-lunch'

const plan = {
  id: 'p1', name: 'Plan', mealsPerDay: 3, targetCalories: 2000,
  variants: [{
    id: 'v1', mealPlanId: 'p1', dayType: 'all',
    targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 70, meals: [],
  }],
} as unknown as MealPlan

const render = (props: { eaten?: { calories: number; proteinG: number; carbsG: number; fatG: number }; eatenKcal?: number }) =>
  renderToStaticMarkup(createElement(MealPlanSection, {
    plan, onCreate: () => {}, onStepByStep: () => {}, onViewPlan: () => {}, ...props,
  }))

describe('planCardEatenKcal', () => {
  const estimates = [{ mealTypeId: DINNER, kcal: 650 }]

  it('adds a counted estimate to logged food: 600 + 650 = 1,250', () => {
    expect(planCardEatenKcal({ loggedKcal: 600, estimates, loggedMealTypeIds: [LUNCH] })).toBe(1250)
  })

  it('does not count an estimate twice once food is logged for its meal type', () => {
    expect(planCardEatenKcal({ loggedKcal: 1100, estimates, loggedMealTypeIds: [LUNCH, DINNER] })).toBe(1100)
  })

  it('shows the counted figure on a day with only an estimate', () => {
    expect(planCardEatenKcal({ loggedKcal: undefined, estimates, loggedMealTypeIds: [] })).toBe(650)
  })

  it('stays absent when nothing is logged and nothing counts', () => {
    expect(planCardEatenKcal({ loggedKcal: undefined, estimates: [], loggedMealTypeIds: [] })).toBeUndefined()
    expect(planCardEatenKcal({ loggedKcal: undefined, estimates, loggedMealTypeIds: [DINNER] })).toBeUndefined()
  })
})

describe('MealPlanSection calories', () => {
  const eaten = { calories: 600, proteinG: 40, carbsG: 60, fatG: 20 }

  it('prints the counted figure, with macros still the logged ones', () => {
    const html = render({ eaten, eatenKcal: planCardEatenKcal({
      loggedKcal: 600, estimates: [{ mealTypeId: DINNER, kcal: 650 }], loggedMealTypeIds: [LUNCH],
    }) })
    expect(html).toContain('1,250 / 2,000')
    expect(html).not.toContain('600 / 2,000')
    expect(html).toContain('40/150 g')
    expect(html).toContain('60/200 g')
    expect(html).toContain('20/70 g')
  })

  it('shows the counted figure with empty macros on an estimate-only day', () => {
    const html = render({ eatenKcal: 650 })
    expect(html).toContain('650 / 2,000')
    expect(html).toContain('150 g')
  })

  it('shows the plain target when nothing is eaten', () => {
    const html = render({})
    expect(html).not.toContain(' / 2,000')
    expect(html).toContain('2,000')
  })
})
