import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

// A merge's tombstones all carry the time its transaction started, and it commits a little later.
// Reading back this far before the device's cursor means a merge that was still committing when the
// last answer was taken is not missed. Dropping a food twice is harmless.
const OVERLAP_MS = 10 * 60_000

const QuerySchema = z.object({ since: z.string().datetime({ offset: true }).optional() }).strict()

/**
 * #3476. For a device that caches the food library (TrainingAi Preview): the foods the look-alike
 * merge (#2417) retired since `since`, which the device drops, and fresh copies of their keepers,
 * which may have gained a barcode or picture in the merge. The list route returns live rows only and
 * stops at 20, so it can say neither. No `since` means from the beginning. The answer's `at` is the
 * next call's `since`.
 */
export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`food-items-retired:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const parsed = QuerySchema.safeParse({ since: new URL(req.url).searchParams.get('since') ?? undefined })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid since' }, { status: 400, headers: NO_STORE })
  const at = new Date()
  const since = parsed.data.since ? new Date(Date.parse(parsed.data.since) - OVERLAP_MS) : new Date(0)
  const repo = await getRepository()
  const { retired, keepers } = await repo.listRetiredFoodItems(userId, since)
  return NextResponse.json({ retired, keepers, at: at.toISOString() }, { headers: NO_STORE })
}
