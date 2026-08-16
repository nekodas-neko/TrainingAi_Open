import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

const MealTypeSchema = z.object({
  name:             z.string().min(1).max(100),
  emoji:            z.string().max(10).optional(),
  sortOrder:        z.number().int().min(0).max(999).optional(),
  timeStartHour:    z.number().int().min(0).max(23).optional(),
  timeEndHour:      z.number().int().min(0).max(24).optional(),
  remindersEnabled: z.boolean().optional(),
  required:         z.boolean().optional(),
})

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const repo = await getRepository()
  await repo.seedDefaultMealTypes(userId)
  const mealTypes = await repo.listMealTypes(userId)
  return NextResponse.json(mealTypes, { headers: { "Cache-Control": "private, no-store" } })
}

export async function PATCH(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const { orderedIds } = body as { orderedIds?: unknown }
  if (!Array.isArray(orderedIds) || orderedIds.some(id => typeof id !== 'string')) {
    return NextResponse.json({ error: 'orderedIds must be an array of strings' }, { status: 400 })
  }
  if (orderedIds.length > 50) {
    return NextResponse.json({ error: 'Too many meal types' }, { status: 413 })
  }
  const repo = await getRepository()
  await repo.reorderMealTypes(userId, orderedIds as string[])
  return NextResponse.json({ ok: true })
}

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = MealTypeSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const { name, emoji, sortOrder, timeStartHour, timeEndHour, remindersEnabled, required } = parsed.data
  const repo = await getRepository()
  const mealType = await repo.createMealType(userId, {
    name, emoji: emoji ?? '🍽️',
    sortOrder: sortOrder ?? 0,
    timeStartHour: timeStartHour ?? 0,
    timeEndHour: timeEndHour ?? 24,
    remindersEnabled: remindersEnabled ?? true,
    required: required ?? true,
  })
  return NextResponse.json(mealType, { status: 201 })
}
