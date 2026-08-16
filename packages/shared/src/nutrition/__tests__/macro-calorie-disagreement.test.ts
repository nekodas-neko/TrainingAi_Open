import { describe, it, expect } from 'vitest'
import {
  macroCalorieDisagreement, sanitiseNutrition,
  ATWATER_DEVIATION_LIMIT, MACRO_MISMATCH_VISIBLE_LIMIT,
} from '../scan-totals'

describe('macroCalorieDisagreement', () => {
  it('is zero when the macros account for the stated calories', () => {
    // 10*4 + 20*4 + 5*9 = 165
    expect(macroCalorieDisagreement({ calories: 165, proteinG: 10, carbsG: 20, fatG: 5 })).toBe(0)
  })

  // The measured row that produced this feature: a real Open Food Facts entry for greek yogurt.
  it('reports the real 27% gap on the row this was written for', () => {
    const off = macroCalorieDisagreement({ calories: 96, proteinG: 5, carbsG: 3, fatG: 10 })
    expect(off).toBeCloseTo(26 / 96, 3)
    expect(off!).toBeGreaterThan(MACRO_MISMATCH_VISIBLE_LIMIT)
  })

  it('has nothing to say when either side is missing', () => {
    expect(macroCalorieDisagreement({ calories: 0, proteinG: 5, carbsG: 3, fatG: 10 })).toBeNull()
    expect(macroCalorieDisagreement({ calories: 100 })).toBeNull()
    expect(macroCalorieDisagreement({})).toBeNull()
  })

  it('ignores negative inputs rather than producing a nonsense ratio', () => {
    expect(macroCalorieDisagreement({ calories: -5, proteinG: 10 })).toBeNull()
  })
})

describe('the two thresholds are consistent', () => {
  // If the visible threshold were the looser one, a row could be silently rewritten by the
  // sanitiser while the picker called it fine — or warned about but never corrected.
  it('warns before it rewrites', () => {
    expect(MACRO_MISMATCH_VISIBLE_LIMIT).toBeLessThan(ATWATER_DEVIATION_LIMIT)
  })

  it('a row between the two keeps its stated calories AND gets flagged', () => {
    const row = { calories: 96, proteinG: 5, carbsG: 3, fatG: 10, servingSizeG: 100 }
    const off = macroCalorieDisagreement(row)!
    expect(off).toBeGreaterThan(MACRO_MISMATCH_VISIBLE_LIMIT)
    expect(off).toBeLessThan(ATWATER_DEVIATION_LIMIT)
    // Not rewritten — which is exactly why the warning has to exist.
    expect(sanitiseNutrition(row).calories).toBe(96)
  })

  it('a row past the rewrite limit has its calories corrected from the macros', () => {
    // 5*4 + 3*4 + 10*9 = 122 against a stated 50 → 144% out.
    expect(sanitiseNutrition({ calories: 50, proteinG: 5, carbsG: 3, fatG: 10, servingSizeG: 100 }).calories)
      .toBe(122)
  })
})
