import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  // LB-18 — `mealTypeId` is OPTIONAL now, and absent means every bucket. It used to be a 400.
  //
  // The route keeps its name rather than gaining a sibling: a second near-identical route for the
  // same concept is how two recency rules end up disagreeing, and the owner's answer ("all recently
  // entered foods/meals") makes the unscoped list the default rather than a variant. Lane B's swap
  // is dropping the query param, which is what `RecentFoodsPanel`'s own comment predicts —
  // "the swap is this component's fetch and nothing else".
  const mealTypeId = searchParams.get('mealTypeId')
  const repo = await getRepository()
  // 12 unscoped against 5 for one bucket: the panel asks for 12 locally and the global list is
  // drawn from every meal of the day, so the old 5 would cut it off mid-breakfast.
  const items = mealTypeId
    ? await repo.listRecentFoodItemsForMealType(userId, mealTypeId, 5)
    : await repo.listRecentFoodItems(userId, 12)
  return NextResponse.json(items, { headers: { "Cache-Control": "private, no-store" } })
}
