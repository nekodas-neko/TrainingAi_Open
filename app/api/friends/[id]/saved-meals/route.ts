import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { invalidUuidResponse } from '@/lib/api/route-errors'
import { reportServerError } from '@/lib/observability'
import { rateLimit } from '@/lib/rate-limit'
import { sharedMealFromSaved } from '@trainingai/shared/nutrition/label-payload'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * Every refusal is this one response. A stranger, a pending request, somebody else's friendship and
 * a friend who has not opted in must be indistinguishable: a different body for the last would tell
 * the caller a friend's setting, and for the first would confirm a user exists.
 */
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })

/**
 * A friend's saved meals, for browsing and copying. **`[id]` is the FRIENDSHIP id**, as in the sibling
 * `PATCH/DELETE /api/friends/[id]` (Next requires one slug name per level), not a user id: the server
 * works out who the friend is, so the client never names a user it may read.
 *
 * Only name, servings, ingredients and macros leave: no ids, no times eaten, no image, no tags. A
 * copy goes through `saveSharedMealToLibrary` on the device, which is why nothing here is writable.
 * `savedAt` is `createdAt`, since `saved_meals` has no edit time.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId

  // Keyed on the viewer and applied before any lookup, so probing friendship ids costs the prober.
  if (!rateLimit(`friend-saved-meals:${userId}`, 30, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: NO_STORE })
  }

  try {
    const repo = await getRepositoryAsync()
    const meals = await repo.listFriendSavedMeals(id, userId)
    if (!meals) return notFound()

    return NextResponse.json({
      meals: meals
        .map(m => ({ mealId: m.id, savedAt: m.createdAt.toISOString(), meal: sharedMealFromSaved(m) }))
        // `saveSharedMealToLibrary` refuses an empty recipe, so a meal with no usable ingredient is
        // not offered rather than offered and failing on tap.
        .filter(m => m.meal.ingredients.length > 0),
    }, { headers: NO_STORE })
  } catch (e: unknown) {
    reportServerError(e, { userId, url: '/api/friends/[id]/saved-meals' })
    return NextResponse.json({ error: 'Could not load that library' }, { status: 500, headers: NO_STORE })
  }
}
