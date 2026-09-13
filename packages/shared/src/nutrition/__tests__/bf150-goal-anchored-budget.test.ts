import { describe, it, expect } from 'vitest'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'

// The owner's real figures, 2026-09-12: calibrated resting base 2,196, goal delta −200,
// earned 131, stored goal 1,660 (verified against production `nutrition_targets`).
const REAL = { restingBaseKcal: 2196, activeKcal: 131, targetNetKcal: -200 }

describe('BF-150 against the owner\'s own numbers', () => {
  it('reproduces the 2,127 he reported before the change', () => {
    expect(budgetProvenance(REAL)).toMatchObject({ base: 1996, earned: 131, total: 2127, anchoredToGoal: false })
  })
  it('anchors to the stored goal after it', () => {
    expect(budgetProvenance({ ...REAL, goalKcal: 1660 }))
      .toMatchObject({ base: 1660, earned: 131, total: 1791, anchoredToGoal: true })
  })
  it('would read 1,481 if he sets his goal to his 1,350 resting rate', () => {
    expect(budgetProvenance({ ...REAL, goalKcal: 1350 }).total).toBe(1481)
  })
  it('does not apply the goal delta on top of the goal', () => {
    const a = budgetProvenance({ ...REAL, goalKcal: 1660 })
    const b = budgetProvenance({ ...REAL, targetNetKcal: -500, goalKcal: 1660 })
    expect(a.total).toBe(b.total)
  })
  for (const bad of [null, undefined, 0, -100, NaN, Infinity]) {
    it(`falls back to the old budget for goalKcal=${String(bad)}`, () => {
      expect(budgetProvenance({ ...REAL, goalKcal: bad as number }).total).toBe(2127)
    })
  }
})
