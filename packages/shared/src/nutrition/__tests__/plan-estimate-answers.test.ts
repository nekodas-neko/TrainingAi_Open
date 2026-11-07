// #3650. The one rule both apps use to decide which plan-meal estimates to write.
import { describe, it, expect } from 'vitest'
import type { MealPlan, MealType } from '@trainingai/shared/types/nutrition'
import { planEstimateAnswers } from '../plan-estimate-answers'

const lunch = { id: 'lunch', name: 'Lunch', timeStartHour: 11, timeEndHour: 15 } as unknown as MealType
const meal = (id: string, kcal: number) => ({
  id, position: 0, name: id, mealTypeId: 'lunch', suggestedTime: '12:30',
  targetCalories: kcal, targetProteinG: 40, targetCarbsG: 60, targetFatG: 15, ingredients: [],
})
const plan = (variants: { dayType: string; meals: ReturnType<typeof meal>[] }[]) =>
  ({ id: 'p', variants }) as unknown as MealPlan
const none = new Set<string>()
const base = { mealTypes: [lunch], loggedMealTypeIds: none, answeredPlanMealIds: none, localHour: 16 }

describe('planEstimateAnswers', () => {
  it('returns the queued payload for a slot that is over', () => {
    expect(planEstimateAnswers({ ...base, plan: plan([{ dayType: 'all', meals: [meal('bowl', 620)] }]), isTrainingDay: undefined }))
      .toEqual([{
        planMealId: 'bowl', answer: 'estimated', estCalories: 620, estProteinG: 40, estCarbsG: 60,
        estFatG: 15, estBiasKcal: 0, estBasis: 'planA',
      }])
  })
  it('declines a split plan on an unknown day, and picks the known day’s variant', () => {
    const split = plan([
      { dayType: 'training', meals: [meal('t', 700)] },
      { dayType: 'rest', meals: [meal('r', 450)] },
    ])
    expect(planEstimateAnswers({ ...base, plan: split, isTrainingDay: undefined })).toEqual([])
    expect(planEstimateAnswers({ ...base, plan: split, isTrainingDay: true }).map(e => e.planMealId)).toEqual(['t'])
  })
  it('writes nothing with no plan, before the slot is over, or once the meal type is logged', () => {
    const p = plan([{ dayType: 'all', meals: [meal('bowl', 620)] }])
    expect(planEstimateAnswers({ ...base, plan: null, isTrainingDay: undefined })).toEqual([])
    expect(planEstimateAnswers({ ...base, plan: p, isTrainingDay: undefined, localHour: 14 })).toEqual([])
    expect(planEstimateAnswers({ ...base, plan: p, isTrainingDay: undefined, loggedMealTypeIds: new Set(['lunch']) })).toEqual([])
  })
})
