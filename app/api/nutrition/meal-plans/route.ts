import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import type { MealPlan } from '@trainingai/shared/types/nutrition'
import { NutritionIngredientsSchema } from '@trainingai/shared/validators/nutrition-ingredient'

export interface MealPlansResponse {
  plans: MealPlan[]
  activePlanId: string | null
}

// Every field whitelisted explicitly. A raw body must never reach Drizzle `.set()`/`.values()` —
// `userId` and `deletedAt` are settable column keys and the TypeScript Omit<> is compile-time only.
const MealSchema = z.object({
  mealTypeId: z.string().uuid().nullable().optional(),
  savedMealId: z.string().uuid().nullable().optional(),
  position: z.number().int().min(0).max(20),
  name: z.string().min(1).max(200),
  notes: z.string().max(2000).nullable().optional(),
  targetCalories: z.number().int().min(0).max(10000),
  targetProteinG: z.number().min(0).max(1000),
  targetCarbsG: z.number().min(0).max(1000),
  targetFatG: z.number().min(0).max(1000),
  // Q-192: the food itself, snapshotted. Without this a saved plan cannot be re-scaled or edited,
  // so swapping one meal meant rebuilding the plan.
  ingredients: NutritionIngredientsSchema.optional(),
  suggestedTime: z.string().regex(/^\d{1,2}:\d{2}$/).nullable().optional(),
})

const VariantSchema = z.object({
  dayType: z.enum(['all', 'training', 'rest']),
  targetCalories: z.number().int().min(0).max(20000),
  targetProteinG: z.number().min(0).max(2000),
  targetCarbsG: z.number().min(0).max(2000),
  targetFatG: z.number().min(0).max(2000),
  meals: z.array(MealSchema).min(1).max(20),
})

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  mealsPerDay: z.number().int().min(1).max(6),
  targetCalories: z.number().int().min(0).max(20000),
  targetProteinG: z.number().min(0).max(2000),
  targetCarbsG: z.number().min(0).max(2000),
  targetFatG: z.number().min(0).max(2000),
  trainingTime: z.string().regex(/^\d{1,2}:\d{2}$/).nullable().optional(),
  stores: z.array(z.string().max(60)).max(20).optional(),
  excludedFoods: z.array(z.string().max(80)).max(200).optional(),
  restrictionsSnapshot: z.array(z.object({
    code: z.string().max(60),
    label: z.string().max(120),
    severity: z.enum(['avoid', 'allergy']),
  })).max(60).optional(),
  avoidNote: z.string().max(2000).nullable().optional(),
  // 'all' alone, or the training/rest pair — never a partial split.
  variants: z.array(VariantSchema).min(1).max(2),
  activate: z.boolean().optional(),
})

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const plans = await repo.listMealPlans(userId)
  return NextResponse.json<MealPlansResponse>(
    { plans, activePlanId: plans.find(p => p.isActive)?.id ?? null },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = CreateSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const dayTypes = parsed.data.variants.map(v => v.dayType).sort().join(',')
  if (dayTypes !== 'all' && dayTypes !== 'rest,training') {
    return NextResponse.json(
      { error: 'Variants must be a single "all" or the "training"+"rest" pair' },
      { status: 400 },
    )
  }

  const repo = await getRepository()
  const plan = await repo.createMealPlan(userId, parsed.data)
  return NextResponse.json(plan, { status: 201 })
}
