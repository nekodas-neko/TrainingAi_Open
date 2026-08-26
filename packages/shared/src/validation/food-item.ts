import { z } from 'zod'

/**
 * The bounds a food item must satisfy, wherever it enters the system.
 *
 * `POST /api/nutrition/food-items` has enforced these since it was written; the offline
 * `pushMutations` branch that mirrors it enforced **nothing** — it type-checked `id` and
 * `name` and coerced every nutrition field with `typeof v === 'number' ? v : 0`, so the web
 * route's caps were bypassed entirely by queueing the same write offline (Q-24 §5). Sharing
 * one schema is what stops the two drifting again.
 *
 * Bounds reject the physically impossible, not an unusual meal: 10,000 kcal or 1 kg of
 * protein in a single item is a corrupt payload, not a big dinner.
 */
export const FoodItemFieldsSchema = z.object({
  name:         z.string().min(1).max(200),
  brand:        z.string().max(100).optional(),
  servingSizeG: z.number().min(0.1).max(5000).optional(),
  calories:     z.number().min(0).max(10000),
  proteinG:     z.number().min(0).max(1000).optional(),
  carbsG:       z.number().min(0).max(1000).optional(),
  fatG:         z.number().min(0).max(1000).optional(),
  fiberG:       z.number().min(0).max(200).optional(),
  sugarG:       z.number().min(0).max(1000).optional(),
  sodiumMg:     z.number().min(0).max(100000).optional(),
  satFatG:      z.number().min(0).max(1000).optional(),
  source:       z.enum(['manual', 'ai', 'barcode', 'text']).optional(),
  barcode:      z.string().max(20).optional(),
  region:       z.string().max(10).optional(),
  /**
   * BF-35. A capped base64 thumbnail. `.nullable()` as well as `.optional()` because the local
   * mirror stores `null` for "no picture" and the outbox pushes what it stored — Zod `.optional()`
   * alone REJECTS null, which is the bug that broke every food save in v1.42.4.
   *
   * The length bound is a coarse backstop only: the real cap is `FOOD_ITEM_IMAGE_MAX_BYTES` in
   * bytes, enforced by `rejectMealImage` at the write site. Two definitions of one limit would
   * drift, so this one is deliberately loose — it exists to keep a megabyte out of the parser,
   * not to be the limit.
   */
  imageDataUri: z.string().max(64_000).nullable().optional(),
})

/** The offline-push shape: the same fields, plus the client-generated row id. */
export const FoodItemPushSchema = FoodItemFieldsSchema.extend({
  id: z.string().min(1).max(64),
})
