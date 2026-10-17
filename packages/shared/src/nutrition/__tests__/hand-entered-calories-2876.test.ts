import { describe, it, expect } from 'vitest'
import {
  sanitiseFoodItemNutrition, normaliseHandEnteredNutrition, sanitiseNutrition,
} from '@trainingai/shared/nutrition/scan-totals'

// #2876. A hand-entered food with calories and its macros left at zero was saved as 0 kcal, because
// every food-item write ran the scan repair, which trusts the macros over a calorie figure that
// disagrees with them by more than 40%.

describe('hand-entered foods keep their values (#2876)', () => {
  it('keeps the calories of a calorie-only entry', () => {
    const out = sanitiseFoodItemNutrition({ calories: 50, proteinG: 0, carbsG: 0, fatG: 0, servingSizeG: 100 }, 'manual')
    expect(out.calories).toBe(50)
    expect(out.proteinG).toBe(0)
  })

  it('treats a missing source as hand-entered, like the routes do', () => {
    expect(sanitiseFoodItemNutrition({ calories: 50, servingSizeG: 30 }, undefined).calories).toBe(50)
    expect(sanitiseFoodItemNutrition({ calories: 50, servingSizeG: 30 }, null).calories).toBe(50)
  })

  it('keeps calories that disagree with the typed macros', () => {
    // 40 g of protein is 160 kcal by Atwater; the label says 300 (fat not typed). The person's figure stands.
    const out = sanitiseFoodItemNutrition({ calories: 300, proteinG: 40, servingSizeG: 100 }, 'manual')
    expect(out.calories).toBe(300)
    expect(out.proteinG).toBe(40)
  })

  it('fills calories from the macros only when none were typed (the opposite case)', () => {
    // 20P/10C/5F = 80 + 40 + 45 = 165. A 0 in the calorie field is its default, not a measurement.
    const out = sanitiseFoodItemNutrition({ calories: 0, proteinG: 20, carbsG: 10, fatG: 5, servingSizeG: 100 }, 'manual')
    expect(out.calories).toBe(165)
  })

  it('leaves an entry with nothing typed at zero', () => {
    expect(sanitiseFoodItemNutrition({ calories: 0, servingSizeG: 100 }, 'manual').calories).toBe(0)
  })

  it('does not cap a large hand-entered food at the scan ceiling', () => {
    // The scan repair clamps at 3,000 kcal; the schema allows 10,000 for a typed whole pizza or tray.
    expect(sanitiseFoodItemNutrition({ calories: 3400, servingSizeG: 1200 }, 'manual').calories).toBe(3400)
  })

  it('normalises shape only: junk to 0, default serving, rounding to the columns', () => {
    const out = normaliseHandEnteredNutrition({ calories: 50.6, proteinG: -3, carbsG: 1.26, servingSizeG: 0 })
    expect(out).toMatchObject({ calories: 51, proteinG: 0, carbsG: 1.3, fatG: 0, servingSizeG: 100 })
    // A typed half gram stays: the column is a double (the native app pins the same case).
    expect(normaliseHandEnteredNutrition({ calories: 350, servingSizeG: 100.5 }).servingSizeG).toBe(100.5)
  })
})

describe('scans keep their repair (#2876)', () => {
  it.each(['ai', 'barcode', 'text'] as const)('repairs a hallucinated calorie figure from a %s source', source => {
    // 900 kcal against 10P/10C/2F (98 kcal) is the model inventing a number; the macros win.
    const raw = { servingSizeG: 100, calories: 900, proteinG: 10, carbsG: 10, fatG: 2 }
    const out = sanitiseFoodItemNutrition(raw, source)
    expect(out.calories).toBe(98)
    expect(out).toEqual(sanitiseNutrition(raw))
  })

  it('still replaces a scan with calories and zero macros, which is the case the repair exists for', () => {
    expect(sanitiseFoodItemNutrition({ calories: 50, proteinG: 0, carbsG: 0, fatG: 0, servingSizeG: 100 }, 'ai').calories).toBe(0)
  })

  it('treats an unknown source as a scan', () => {
    expect(sanitiseFoodItemNutrition({ servingSizeG: 100, calories: 900, proteinG: 10, carbsG: 10, fatG: 2 }, 'something-new').calories).toBe(98)
  })
})
