import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'
import { errorLog } from '@trainingai/shared/logger'
import { CoachContextSchema } from '@trainingai/shared/coach/context'
import { getDb, ensureSchema } from '@/lib/data/postgres/client'
import { buildCoachAbout } from '@/lib/coach/about'
import { coachScope, isCoachScopeId, withClientDomains } from '@/lib/coach/scopes'

const CACHE_HEADERS = { 'Cache-Control': 'private, no-store' }

const QuerySchema = z.object({
  /** As the chat route: an unknown scope widens to `general`. */
  scope: z.string().max(40).optional(),
  /** The gated patch domains the client renders, comma-separated, as the chat request's `patchDomains`. */
  patchDomains: z.string().max(200).optional(),
}).strict()

/**
 * The top of the Coach when it opens (#3896 steps 6 and 7): the context line and the buttons.
 *
 * Read-only, and no model call. The context is ids only, validated by the chat route's own schema;
 * every id is checked against the signed-in user before anything is read by it, and a foreign or
 * unknown one is a 404, as the chat route answers it (`lib/coach/about.ts`). The buttons are chosen
 * here from what was checked, never from what the client says it is looking at.
 */
export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`${userId}:coach-about`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const params = new URL(req.url).searchParams
  const { scope: rawScope, patchDomains, ...rest } = Object.fromEntries(params)
  const query = QuerySchema.safeParse({ scope: rawScope, patchDomains })
  const hasContext = Object.keys(rest).length > 0
  const context = hasContext ? CoachContextSchema.safeParse(rest) : null
  if (!query.success || (context && !context.success)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  try {
    const scopeId = isCoachScopeId(query.data.scope) && query.data.scope === 'nutrition' ? 'nutrition' : 'general'
    const scope = withClientDomains(coachScope(scopeId), query.data.patchDomains?.split(',').filter(Boolean))
    const tz = session.user?.timezone ?? DEFAULT_TZ
    await ensureSchema()
    const result = await buildCoachAbout(getDb(), await getRepositoryAsync(), userId, context?.data, {
      scope: scopeId,
      liftPreference: scope.patchDomains.includes('lift_preference'),
      tz,
      today: todayInTz(tz),
    })
    if (!result.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(result.about, { headers: CACHE_HEADERS })
  } catch (error) {
    errorLog(error, 'API /coach/about')
    return NextResponse.json({ error: 'Could not read the Coach context' }, { status: 500 })
  }
}
