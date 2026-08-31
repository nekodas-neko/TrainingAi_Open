// BF-70. The Open Food Facts thumbnail was fetched successfully and then discarded by every layer
// between the route and the stored row. These pin the two shared links in that chain, and the
// source label that made `'barcode'` a value nothing ever wrote.
import { describe, it, expect } from 'vitest'
import { scanOriginToSource } from '../log-food'
import { sanitiseNutrition } from '../scan-totals'
import { offProductToNutrition } from '../open-food-facts'

describe('scanOriginToSource', () => {
  // The defect: a barcode result carries `confidence: 'high'`, so the old rule
  // (`confidence ? 'ai' : 'manual'`) stored every barcode scan as `'ai'`. BF-38 measured the
  // consequence — 3 rows of 221 carrying `'barcode'`.
  it('labels a barcode scan as barcode, not ai', () => {
    expect(scanOriginToSource('barcode', 'high')).toBe('barcode')
  })

  it('labels a photo scan as ai', () => {
    expect(scanOriginToSource('photo', 'medium')).toBe('ai')
  })

  // Not a chosen label: `food_items.source` has no value for an OFF text lookup, and adding one is
  // a migration. Pinned so the compromise is visible rather than looking like an oversight.
  it('labels an OFF text search as ai, which is the wrong label the column cannot express', () => {
    expect(scanOriginToSource('search', 'high')).toBe('ai')
  })

  // A producer that predates the field must behave exactly as it did.
  it('falls back to the old confidence rule when no origin is set', () => {
    expect(scanOriginToSource(undefined, 'high')).toBe('ai')
    expect(scanOriginToSource(undefined, undefined)).toBe('manual')
  })
})

describe('offProductToNutrition', () => {
  const product = {
    product_name: 'Loaded Mac & Cheese',
    brands: 'Core Powerfoods',
    nutriments: {
      'energy-kcal_100g': 120, proteins_100g: 9, carbohydrates_100g: 12, fat_100g: 3,
    },
  }

  it('stamps an origin so a caller never has to infer one from confidence or prose', () => {
    const r = offProductToNutrition(product as never)
    expect(r?.origin).toBe('search')
    // …and the signal that used to be inferred from is still identical for both OFF routes,
    // which is exactly why it could not be used.
    expect(r?.confidence).toBe('high')
  })
})

describe('sanitiseNutrition', () => {
  // The line `imageDataUri: s.imageDataUri ?? null` typechecked for as long as `RawNutrition`
  // declared the field, and resolved to `undefined` on every call because nothing sets it.
  //
  // A runtime test cannot pin this: the value is absent whether or not the TYPE declares it, and
  // the declaration is the whole defect. `@ts-expect-error` cannot pin it either — `tsconfig.json`
  // excludes `**/__tests__/**`, so nothing here is typechecked at all. The guard is
  // `scripts/check-sanitiser-no-image-field.js`. What this covers is the behaviour that made the
  // dead read look harmless: a caller passing only numbers gets only numbers back.
  it('returns no image for a caller that passed only numbers', () => {
    const out = sanitiseNutrition({
      calories: 120, proteinG: 9, carbsG: 12, fatG: 3, servingSizeG: 100,
    }) as Record<string, unknown>
    expect('imageDataUri' in out).toBe(false)
    expect(out.calories).toBe(120)
  })
})
