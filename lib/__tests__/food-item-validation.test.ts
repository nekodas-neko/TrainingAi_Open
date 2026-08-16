import { describe, it, expect } from 'vitest'
import { FoodItemFieldsSchema, FoodItemPushSchema } from '@trainingai/shared/validation/food-item'

// Q-24 §5: the offline push branch had no schema at all, so queueing a write offline
// bypassed every cap the web route enforced. Both now parse the same object.
const valid = { id: 'fi-1', name: 'Oats', calories: 380, proteinG: 13, carbsG: 60, fatG: 7 }

describe('FoodItemPushSchema — the offline path enforces the web route caps', () => {
  it('accepts an ordinary item', () => {
    expect(FoodItemPushSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a non-number where the old code silently coerced it to 0', () => {
    // `typeof v === 'number' ? v : 0` turned "lots" into 0 calories and stored it.
    expect(FoodItemPushSchema.safeParse({ ...valid, calories: 'lots' }).success).toBe(false)
    expect(FoodItemPushSchema.safeParse({ ...valid, proteinG: null }).success).toBe(false)
  })

  it('rejects physically impossible values', () => {
    expect(FoodItemPushSchema.safeParse({ ...valid, calories: 999999 }).success).toBe(false)
    expect(FoodItemPushSchema.safeParse({ ...valid, proteinG: 5000 }).success).toBe(false)
    expect(FoodItemPushSchema.safeParse({ ...valid, servingSizeG: 100000 }).success).toBe(false)
  })

  it('rejects negatives', () => {
    expect(FoodItemPushSchema.safeParse({ ...valid, calories: -1 }).success).toBe(false)
    expect(FoodItemPushSchema.safeParse({ ...valid, sodiumMg: -5 }).success).toBe(false)
  })

  it('requires a name and an id', () => {
    expect(FoodItemPushSchema.safeParse({ ...valid, name: '' }).success).toBe(false)
    const { id: _id, ...noId } = valid
    expect(FoodItemPushSchema.safeParse(noId).success).toBe(false)
  })

  it('rejects an unknown source rather than coercing it', () => {
    // The old cast `p.source as 'ai' | 'manual' | ...` accepted any string at runtime.
    expect(FoodItemPushSchema.safeParse({ ...valid, source: 'wherever' }).success).toBe(false)
  })

  it('the push schema is the web schema plus an id — the two cannot drift', () => {
    const { id: _id, ...fields } = valid
    expect(FoodItemFieldsSchema.safeParse(fields).success).toBe(true)
    expect(FoodItemFieldsSchema.safeParse({ ...fields, calories: 999999 }).success).toBe(false)
  })
})
