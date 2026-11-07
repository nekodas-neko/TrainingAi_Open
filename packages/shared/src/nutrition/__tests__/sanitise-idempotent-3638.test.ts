// #3638. Preview repairs a scanned food once and the server repairs the pushed food again, then
// Preview reads it back and compares exactly. A second pass that moves a value meant the read-back
// never matched, and every nutrition change queued behind that food waited for good.
import { describe, expect, it } from 'vitest'
import { sanitiseFoodItemNutrition, sanitiseNutrition } from '../scan-totals'

const KEYS = ['servingSizeG', 'calories', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'sugarG', 'satFatG', 'sodiumMg'] as const

describe('sanitiseNutrition is idempotent', () => {
  it('caps fat against the serving as stored, not before rounding (the reported scan)', () => {
    const once = sanitiseFoodItemNutrition({ servingSizeG: 58.1, calories: 640, proteinG: 2, carbsG: 3, fatG: 69.3 }, 'barcode')
    expect(once.servingSizeG).toBe(58)
    expect(once.fatG).toBe(58)
    expect(sanitiseFoodItemNutrition(once, 'barcode')).toEqual(once)
  })

  it('applies the 3000 kcal cap before the fat check, so a second pass leaves fat alone', () => {
    const once = sanitiseNutrition({ servingSizeG: 1294.4, calories: 600.6, proteinG: 37.2, carbsG: 23.8, fatG: 401.4 })
    expect(sanitiseNutrition(once)).toEqual(once)
  })

  it('holds for a seeded spread of scans', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const value = () => {
      const r = rnd()
      return r < 0.1 ? 0 : Math.round(rnd() * (r < 0.5 ? 100 : 2500) * 10) / 10
    }
    for (let i = 0; i < 20000; i++) {
      const raw = Object.fromEntries(KEYS.map((key) => [key, value()]))
      const once = sanitiseNutrition(raw)
      expect(sanitiseNutrition(once), JSON.stringify(raw)).toEqual(once)
    }
  })
})
