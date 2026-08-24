import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getDb, ensureSchema } from '@/lib/data/postgres/client'
import { rateLimit } from '@/lib/rate-limit'
import { CoachPatchSchema, hasUniqueChangeIds } from '@/lib/coach/patch'
import { applyCoachPatch } from '@/lib/coach/apply'
import { invalidateProgramStructure } from '@/lib/cache-groups'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'
import { errorLog } from '@trainingai/shared/logger'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// A patch of at most 8 changes plus up to 8 accepted ids. 256 KB is far past any real patch.
const MAX_BODY_BYTES = 256 * 1024

const BodySchema = z.object({
  patch: CoachPatchSchema,
  /** Only these change ids are written. The rest of the patch is recorded but not applied — what
   *  the assistant suggested is part of the history, not just what was taken. */
  acceptedChangeIds: z.array(z.string().min(1)).min(1).max(8),
}).strict()

/**
 * The only place AI Coach writes. The chat route never does.
 *
 * Zod-whitelisted at the boundary rather than passing a request body into `.set()` — `userId` and
 * timestamps are settable column keys and a TypeScript `Omit<>` is compile-time only.
 */
export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`${userId}:coach-apply`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  if (!hasUniqueChangeIds(parsed.data.patch)) {
    return NextResponse.json({ error: 'Duplicate change ids' }, { status: 400 })
  }

  try {
    await ensureSchema()
    const result = await applyCoachPatch(
      getDb(),
      userId,
      parsed.data.patch,
      parsed.data.acceptedChangeIds,
      todayInTz(session.user?.timezone ?? DEFAULT_TZ),
      session.user?.timezone ?? DEFAULT_TZ,
    )

    if (!result.ok) {
      if (result.reason === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 })
      if (result.reason === 'stale') {
        // 409, not 400: the request was well-formed, the world moved. The widget renders this as
        // "out of date — ask again" rather than a generic failure.
        return NextResponse.json({ error: 'This suggestion is out of date', drift: result.drift }, { status: 409 })
      }
      return NextResponse.json({ error: result.detail }, { status: 400 })
    }

    await invalidateProgramStructure()
    return NextResponse.json({ changeId: result.changeId, summary: result.summary })
  } catch (error) {
    errorLog(error, 'API /coach/apply')
    return NextResponse.json({ error: 'Apply failed' }, { status: 500 })
  }
}
