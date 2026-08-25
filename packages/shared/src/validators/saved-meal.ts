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
  // BF-11e — which meal types this meal suits, so a planner does not put pancakes at dinner.
  //
  // `.optional()` with NO `.default([])`, unlike `items` above, and the difference is the whole
  // point: a default would turn "the caller did not mention tags" into "clear the tags", and until
  // BF-11f ships a picker every save from the saved-meals sheet omits them. Same `undefined` vs
  // explicit-`[]` distinction as `imageDataUri`, carried all the way to the upsert.
  //
  // Bounded because it is a client-supplied array reaching a write. Twenty is far past any real
  // configuration — the owner has a handful of meal types — while still refusing a payload built to
  // make the ownership check do work.
  mealTypeIds: z.array(z.string().uuid()).max(20).optional(),
})
