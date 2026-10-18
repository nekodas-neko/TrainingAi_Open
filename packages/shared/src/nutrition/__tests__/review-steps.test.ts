import { describe, it, expect } from 'vitest'
import { visibleReviewSteps, hasUnloggedMeal } from '../review-steps'

const MEALS = [{ id: 'b' }, { id: 'l' }, { id: 'd' }]

describe('visibleReviewSteps', () => {
  it('always shows the day and the wrap-up', () => {
    // Even with nothing configured and nothing logged: step 1 is never omitted, and the wrap-up
    // holds the Save, so a flow without it could not be completed.
    expect(visibleReviewSteps({ mealTypes: [], loggedMealTypeIds: [] })).toEqual(['day', 'wrapUp'])
  })

  it('asks about meals when one is empty', () => {
    expect(visibleReviewSteps({ mealTypes: MEALS, loggedMealTypeIds: ['b', 'l'] }))
      .toEqual(['day', 'meals', 'wrapUp'])
  })

  it('skips the meals step entirely once every meal has something', () => {
    // The point of the step rule: an empty prompt is worse than no step, because it reads as a
    // question the user has to dismiss.
    expect(visibleReviewSteps({ mealTypes: MEALS, loggedMealTypeIds: ['b', 'l', 'd'] }))
      .toEqual(['day', 'wrapUp'])
  })

  it('is not fooled by duplicate logs against one meal', () => {
    // Three logs, all breakfast — two meals are still empty. A count-based check would pass here,
    // which is the reason this is a set membership test rather than `logs.length >= mealTypes.length`.
    expect(hasUnloggedMeal({ mealTypes: MEALS, loggedMealTypeIds: ['b', 'b', 'b'] })).toBe(true)
  })

  it('ignores a log against a meal type that no longer exists', () => {
    // A deleted meal type leaves its logs behind; they must not satisfy a meal that is still configured.
    expect(hasUnloggedMeal({ mealTypes: MEALS, loggedMealTypeIds: ['b', 'l', 'd', 'deleted'] })).toBe(false)
    expect(hasUnloggedMeal({ mealTypes: MEALS, loggedMealTypeIds: ['b', 'l', 'deleted'] })).toBe(true)
  })

  it('has nothing to ask when no meal types are configured', () => {
    expect(hasUnloggedMeal({ mealTypes: [], loggedMealTypeIds: [] })).toBe(false)
  })
})
