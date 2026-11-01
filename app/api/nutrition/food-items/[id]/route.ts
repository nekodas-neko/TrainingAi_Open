import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { invalidUuidResponse } from '@/lib/api/route-errors'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * #2813 — read one owned food item by id, so a native client that minted the id can confirm what
 * the sync endpoint stored. The list route stops at 20 names and cannot answer this.
 *
 * Another user's id and an unknown id answer the same 404, so the route cannot be used to probe
 * which ids exist. A tombstoned `food_items` row (#2417) still
 * answers: a log from a device that has not synced must keep resolving it.
 * The body is the same `FoodItem` the list route returns.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`food-item-read:${userId}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  const repo = await getRepository()
  const item = await repo.getFoodItemById(userId, id)
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  return NextResponse.json(item, { headers: NO_STORE })
}
