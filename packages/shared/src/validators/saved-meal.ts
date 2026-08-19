import { z } from 'zod'
import { rejectMealImage, mealImageRejectionMessage } from '../nutrition/meal-image'

export const SavedMealSchema = z.object({
  // Optional client-minted id so an offline create replays idempotently (the
  // outbox push carries the same id the local row already has).
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  items: z.array(z.object({
    foodItemId: z.string().uuid(),
    quantityMultiplier: z.number().min(0.01).max(100),
  })).max(100).default([]),
  // Portions the recipe makes. Bounded because it divides — a zero would make one portion infinite,
  // and nobody batch-cooks fifty. Defaults to 1 so an older client that does not send it is
  // indistinguishable from a single-portion meal.
  servings: z.number().min(0.25).max(50).default(1),
  // A base64 thumbnail, or `null` to remove one. Validated HERE rather than in each route, so the
  // create and the edit path cannot drift — and re-validated again in `pushMutations`, because the
  // offline replay does not come through either route and a client-side cap is not a cap (Q-396).
  //
  // Omitted (`undefined`) means "the caller did not mention the image" and leaves a stored one
  // alone; that distinction is carried all the way to the upsert.
  imageDataUri: z.string().nullable().optional().superRefine((v, ctx) => {
    const reject = rejectMealImage(v)
    if (reject) ctx.addIssue({ code: 'custom', message: mealImageRejectionMessage(reject) })
  }),
})
