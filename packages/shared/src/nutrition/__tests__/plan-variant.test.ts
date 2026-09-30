// The variant a meal plan shows, and the one BF-203a is allowed to estimate against.
import { describe, it, expect } from 'vitest'
import { pickPlanVariant, variantForEstimates } from '../plan-variant'
import type { MealPlan } from '@trainingai/shared/types/nutrition'

const plan = (...dayTypes: string[]) => ({ variants: dayTypes.map(d => ({ dayType: d, meals: [] })) }) as unknown as MealPlan

describe('pickPlanVariant', () => {
  it('prefers the single all-days variant', () => {
    expect(pickPlanVariant(plan('all'), true).dayType).toBe('all')
  })
  it('picks by day type on a split plan, and falls to rest when unknown', () => {
    expect(pickPlanVariant(plan('training', 'rest'), true).dayType).toBe('training')
    expect(pickPlanVariant(plan('training', 'rest'), false).dayType).toBe('rest')
    expect(pickPlanVariant(plan('training', 'rest'), undefined).dayType).toBe('rest')
  })
})

describe('variantForEstimates', () => {
  // The display fallback is harmless to look at and wrong to count.
  it('refuses a split plan whose day type is unknown', () => {
    expect(variantForEstimates(plan('training', 'rest'), undefined)).toBeNull()
  })
  it('answers when the day type is known, or when the plan is not split', () => {
    expect(variantForEstimates(plan('training', 'rest'), true)?.dayType).toBe('training')
    expect(variantForEstimates(plan('all'), undefined)?.dayType).toBe('all')
  })
})
