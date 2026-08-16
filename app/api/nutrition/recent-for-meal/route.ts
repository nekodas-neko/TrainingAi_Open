import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const mealTypeId = searchParams.get('mealTypeId')
  if (!mealTypeId) return NextResponse.json({ error: 'mealTypeId required' }, { status: 400 })
  const repo = await getRepository()
  const items = await repo.listRecentFoodItemsForMealType(userId, mealTypeId, 5)
  return NextResponse.json(items, { headers: { "Cache-Control": "private, no-store" } })
}
