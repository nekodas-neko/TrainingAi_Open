import { NextResponse } from 'next/server'
import { z } from 'zod'
import { FoodItemFieldsSchema } from '@trainingai/shared/validation/food-item'
import { sanitiseNutrition } from '@trainingai/shared/nutrition/scan-totals'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

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
  const parsed = FoodItemSchema.safeParse(await req.json())
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
  })
  return NextResponse.json(item, { status: 201 })
}
