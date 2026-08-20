import { describe, it, expect } from 'vitest'
import { ringTargets } from '../ring-targets'
import type { EnergyBalanceResponse } from '@/app/api/nutrition/energy-balance/route'
import type { NutritionTargets } from '@trainingai/shared/types/nutrition'

/** The owner's 2026-08-19 day, from the three screenshots that produced Q-417. */
const STORED = { calories: 1_900, proteinG: 150, carbsG: 190, fatG: 60 } as unknown as NutritionTargets

function balanceOf(over: Partial<NonNullable<EnergyBalanceResponse['balance']>> = {}): EnergyBalanceResponse {
  return {
    date: '2026-08-19',
    balance: {
      intakeKcal: 2_014, expenditureKcal: 2_351, restingBaseKcal: 1_800, activeKcal: 551,
      netKcal: -337, targetNetKcal: -171, deviationKcal: -166, remainingKcal: 166,
      projectedWeeklyKg: -0.31, zone: 'on_target', zoneLabel: 'On target', zoneColor: '#22c55e',
      ...over,
    },
    maintenance: null,
    target: { recommendedKcal: null, currentKcal: null, driftsFromRecommendation: false },
    macroTargets: {
      base: { proteinG: 150, carbsG: 190, fatG: 60 },
      scaled: { proteinG: 150, carbsG: 271, fatG: 85 },
      earnedKcal: 551,
    },
    activeBreakdown: { workoutKcal: 0, activityKcal: 0, stepsKcal: 0, workoutKcalBySession: [] },
    goal: null,
    missingProfileFields: [],
  }
}

describe('ringTargets (Q-417, Q-323)', () => {
  /**
   * The defect in one assertion. The ring rendered `stored.calories + <optimistic local burn>` and
   * landed on 2,001 while the Energy Balance card on the same screen showed 2,180 — one card saying
   * "Goal reached" at 2,014 eaten and another saying "166 kcal left".
   */
  it('takes the budget the route published, not the stored goal plus a local burn', () => {
    const t = ringTargets(balanceOf(), STORED)
    expect(t.calories).toBe(1_800 - 171 + 551) // 2,180
    expect(t.calories).not.toBe(STORED.calories + 101) // the 2,001 that shipped
    expect(t.calories).not.toBe(STORED.calories + 551) // and not Q-415's 2,451 either
  })

  /**
   * The budget and the "eaten so far" figure must agree with the headline, which is what makes
   * "Goal reached" trustworthy. `deviation = intake − budget` exactly, so this is checkable.
   */
  it('leaves the day under budget by exactly the deviation the route reported', () => {
    const b = balanceOf()
    const t = ringTargets(b, STORED)
    expect(b.balance!.intakeKcal - t.calories!).toBe(b.balance!.deviationKcal)
    expect(t.calories! - b.balance!.intakeKcal).toBe(b.balance!.remainingKcal)
  })

  it('renders the scaled macro grams, so fat is not reported over when it is well under', () => {
    const t = ringTargets(balanceOf(), STORED)
    expect({ p: t.proteinG, c: t.carbsG, f: t.fatG }).toEqual({ p: 150, c: 271, f: 85 })
    // Protein is dosed per kg of bodyweight and deliberately does not scale with a day's movement.
    expect(t.proteinG).toBe(STORED.proteinG)
  })

  it('reports what movement earned, for the subtitle', () => {
    expect(ringTargets(balanceOf(), STORED).earnedKcal).toBe(551)
    expect(ringTargets(balanceOf({ activeKcal: 0 }), STORED).earnedKcal).toBe(0)
  })

  it('shows no calorie budget rather than a wrong one when the day has no derived baseline', () => {
    // An incomplete profile, or the payload has not arrived yet. Substituting the stored goal is
    // the defect, not the fallback.
    for (const b of [null, { ...balanceOf(), balance: null }]) {
      const t = ringTargets(b, STORED)
      expect(t.calories).toBeNull()
      // The grams are still honest — a macro target is a target, not a budget derived from movement.
      expect(t.proteinG).toBe(150)
      expect(t.carbsG).toBe(190)
      expect(t.earnedKcal).toBe(0)
    }
  })

  it('falls back to the stored grams when the route sends a balance but no macro targets', () => {
    // `macroTargets` is null for a user with no stored nutrition_targets row at all.
    const t = ringTargets({ ...balanceOf(), macroTargets: null }, STORED)
    expect(t.calories).toBe(2_180)
    expect(t.carbsG).toBe(190)
  })

  it('has nothing at all to show for a user with neither', () => {
    const t = ringTargets(null, null)
    expect(t).toEqual({ calories: null, proteinG: null, carbsG: null, fatG: null, earnedKcal: 0 })
  })
})
