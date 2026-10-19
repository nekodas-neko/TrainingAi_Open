import { describe, it, expect } from 'vitest'
import { budgetProvenance, budgetProvenanceText } from '@trainingai/shared/nutrition/calorie-balance'

/**
 * **Q-401.** Two calorie budgets sat on the Nutrition tab 274 kcal apart, both labelled "left",
 * with nothing reconciling them. The root cause was two TDEE models — a wizard multiplier baked
 * into the stored goal, and a sedentary base with measured movement added — and the owner's
 * decision was to keep the second: *"i want the lowest number that assumes no exercise/movement…
 * then we adjust/increase that number [by] activity."*
 *
 * This is the arithmetic that says so on screen. It is a separate exported function, and tested,
 * because **two surfaces render it** (the Nutrition tab and Home's nutrition card) and a second
 * copy of a calorie figure is precisely what produced the entry.
 */
describe('budgetProvenance', () => {
  it('splits the budget into the rest-day floor and what movement earned', () => {
    // The owner's own numbers: 1,826 resting, recomp goal of −200, so 1,626 before moving.
    expect(budgetProvenance({ restingBaseKcal: 1826, activeKcal: 312, targetNetKcal: -200 }))
      .toEqual({ base: 1626, earned: 312, total: 1938, anchoredToRestingRate: false, chain: null, ownTarget: false, workedOutTotal: 1938 })
  })

  it('is the rest-day floor exactly when nothing has been earned', () => {
    const p = budgetProvenance({ restingBaseKcal: 1826, activeKcal: 0, targetNetKcal: -200 })
    expect(p).toEqual({ base: 1626, earned: 0, total: 1626, anchoredToRestingRate: false, chain: null, ownTarget: false, workedOutTotal: 1626 })
  })

  /**
   * A surplus goal is a POSITIVE delta, so the base sits above resting burn. Signing this wrong
   * would show a bulking user a deficit budget and read as a bug in the goal rather than in a
   * subtraction.
   */
  it('adds a surplus goal rather than subtracting it', () => {
    expect(budgetProvenance({ restingBaseKcal: 1800, activeKcal: 0, targetNetKcal: 300 }).base).toBe(2100)
  })

  it('rounds each part, so base + earned always equals the total shown', () => {
    const p = budgetProvenance({ restingBaseKcal: 1826.4, activeKcal: 311.6, targetNetKcal: -200.2 })
    expect(p.base + p.earned).toBe(p.total)
    expect(Number.isInteger(p.base) && Number.isInteger(p.earned)).toBe(true)
  })
})

// The sentence under the bar. The web (calorie-zone-bar.tsx) dims its operators in markup and keeps
// its own JSX; Preview prints this text, so it is pinned branch by branch.
describe('budgetProvenanceText', () => {
  const chain = (over: Partial<NonNullable<ReturnType<typeof budgetProvenance>['chain']>>, extra: Partial<ReturnType<typeof budgetProvenance>> = {}) => ({
    base: 1500, earned: 300, total: 1800, anchoredToRestingRate: true, ownTarget: false, workedOutTotal: 1800,
    chain: { rmr: 1800, deficit: 300, metabolicBurn: 360, stepCredit: 0, dailyLiving: 0, movement: 300, floored: false, totalFloored: false, ...over },
    ...extra,
  })

  it('subtracts a deficit and adds daily living', () => {
    expect(budgetProvenanceText(chain({ dailyLiving: 60 }))).toBe('1,800 resting rate − 300 for your goal + 60 daily living + 300 earned from movement')
  })

  it('adds a surplus: a negative deficit never prints "− -"', () => {
    expect(budgetProvenanceText(chain({ deficit: -300, dailyLiving: 60 }))).toBe('1,800 resting rate + 300 for your goal + 60 daily living + 300 earned from movement')
  })

  it('leaves out a zero goal term on maintain', () => {
    expect(budgetProvenanceText(chain({ deficit: 0, dailyLiving: 60 }))).toBe('1,800 resting rate + 60 daily living + 300 earned from movement')
  })

  it('subtracts a negative daily-living term instead of printing "+ -50"', () => {
    expect(budgetProvenanceText(chain({ dailyLiving: -50 }))).toBe('1,800 resting rate − 300 for your goal − 50 daily living + 300 earned from movement')
  })

  it('says so when nothing has been earned', () => {
    expect(budgetProvenanceText(chain({ movement: 0 }, { earned: 0 }))).toBe('1,800 resting rate − 300 for your goal + 0 daily living — no movement recorded yet today')
  })

  it('prints the whole movement when the floor lifted the still day', () => {
    expect(budgetProvenanceText(chain({ floored: true, movement: 450 }, { earned: 120 }))).toContain('+ 450 earned from movement')
  })

  it('names the floor when it set the whole day, and the own target when there is one', () => {
    expect(budgetProvenanceText(chain({ floored: true, totalFloored: true }, { total: 1800 }))).toBe('1,800 minimum budget — never below your resting rate')
    expect(budgetProvenanceText(chain({}, { ownTarget: true, total: 2100 }))).toBe('Your own target: 2,100 kcal')
  })

  it('keeps the movement breakdown when a caller has one', () => {
    expect(budgetProvenanceText(chain({ deficit: 0 }), { movementParts: 'workouts 200 · steps 100' })).toContain('earned from movement (workouts 200 · steps 100)')
  })

  it('reads the two legacy paths', () => {
    expect(budgetProvenanceText({ base: 1626, earned: 312, total: 1938, anchoredToRestingRate: false, chain: null, ownTarget: false, workedOutTotal: 1938 }, { restingBaseKcal: 1826, targetNetKcal: -200 }))
      .toBe('1,826 base − 200 for your goal + 312 earned from movement')
    expect(budgetProvenanceText({ base: 1826, earned: 0, total: 1826, anchoredToRestingRate: true, chain: null, ownTarget: false, workedOutTotal: 1826 }))
      .toBe('1,826 resting rate — no movement recorded yet today')
  })
})
