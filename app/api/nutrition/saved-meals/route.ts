import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { SavedMealSchema } from '@trainingai/shared/validators/saved-meal'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const repo = await getRepository()
  return NextResponse.json(await repo.listSavedMeals(userId), { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = SavedMealSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const { id, name, items, servings } = parsed.data
  const repo = await getRepository()
  const meal = await repo.createSavedMeal(userId, name, items, id, servings)
  return NextResponse.json(meal, { status: 201 })
}
