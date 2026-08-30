import { NextResponse } from 'next/server'
import { z } from 'zod'
import { FoodItemFieldsSchema } from '@trainingai/shared/validation/food-item'
import { rejectMealImage, mealImageRejectionMessage, FOOD_ITEM_IMAGE_MAX_BYTES } from '@trainingai/shared/nutrition/meal-image'
import { sanitiseNutrition } from '@trainingai/shared/nutrition/scan-totals'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One food item: a name, a brand and a dozen macro numbers.
const MAX_BODY_BYTES = 8 * 1024

// Shared with the offline push branch so the two cannot drift (Q-24 §5).
const FoodItemSchema = FoodItemFieldsSchema

export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const q = new URL(req.url).searchParams.get('q') ?? ''
  const repo = await getRepository()
  const items = await repo.searchFoodItems(userId, q)
  return NextResponse.json(items, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = FoodItemSchema.safeParse(read.body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const body = parsed.data
  // Same Atwater cross-check the AI-scan path already applies before the user ever sees it
  // (lib/nutrition/scan-totals.ts) — this route was the one entry point that bypassed it, so a
  // wildly hallucinated or fat-fingered calorie/macro combo landed uncorrected. Bounds are
  // generous (40% deviation) so a real, unusual meal is never touched.
  const sanitised = sanitiseNutrition({
    calories: body.calories, proteinG: body.proteinG, carbsG: body.carbsG, fatG: body.fatG,
    servingSizeG: body.servingSizeG, fiberG: body.fiberG, sugarG: body.sugarG,
    sodiumMg: body.sodiumMg, satFatG: body.satFatG,
  })
  // BF-35. Server-side, always — a client-side cap is not a cap, and this one is a SYNC budget:
  // `food_items` rides the outbox and the device's SQLite copy, so an oversized image is paid on
  // every device forever. Interactive caller, so it is refused with a message; the offline push
  // branch drops the field instead (see `pushMutations`), because a picture must not cost a food.
  const imageRejection = rejectMealImage(body.imageDataUri, FOOD_ITEM_IMAGE_MAX_BYTES)
  if (imageRejection) {
    return NextResponse.json(
      { error: mealImageRejectionMessage(imageRejection, FOOD_ITEM_IMAGE_MAX_BYTES) },
      { status: 400 },
    )
  }

  const repo = await getRepository()
  const item = await repo.createFoodItem(userId, {
    name: body.name, brand: body.brand,
    servingSizeG: sanitised.servingSizeG ?? 100,
    calories: sanitised.calories ?? 0,
    proteinG: sanitised.proteinG ?? 0,
    carbsG: sanitised.carbsG ?? 0,
    fatG: sanitised.fatG ?? 0,
    fiberG: sanitised.fiberG, sugarG: sanitised.sugarG,
    sodiumMg: sanitised.sodiumMg, satFatG: sanitised.satFatG,
    source: body.source ?? 'manual',
    barcode: body.barcode, region: body.region ?? 'AU',
    imageDataUri: body.imageDataUri ?? null,
  }, {
    // BF-38. An interactive create returns whatever id it is given, so handing back the row the
    // user already has is safe here in a way it is not on the offline push path (see the slice).
    // The rule is exact on name, brand, serving size and macros — it catches the repeat, never the
    // near-miss.
    reuseExisting: true,
  })
  return NextResponse.json(item, { status: 201 })
}
