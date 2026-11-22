/**
 * #3890 step 2: what every weekly check-in route shares. The user is the session's, never the request's;
 * each route has its own rate limit, born with it; a body is size-capped, then parsed by a strict Zod
 * schema before anything else reads it; a refusal from the engine maps to its status with nothing written.
 */
import { NextResponse } from 'next/server'
import type { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { ensureSchema, getDb } from '@/lib/data/postgres/client'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { errorLog } from '@trainingai/shared/logger'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { CheckinRefusal, type EngineCtx } from './engine'

/** A check-in body is a handful of ids and enums; 16 KB is far past any real one. */
const MAX_BODY_BYTES = 16 * 1024

/** Per user, per route, per minute. */
export const CHECKIN_RATE_LIMITS = { state: 60, save: 10, dismiss: 10, offer: 20, undo: 20 } as const

export async function withCheckinRoute<S extends z.ZodTypeAny>(
  req: Request,
  route: keyof typeof CHECKIN_RATE_LIMITS,
  schema: S | null,
  run: (ctx: EngineCtx, body: z.infer<S>) => Promise<unknown>,
): Promise<NextResponse> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:weekly-checkin-${route}`, CHECKIN_RATE_LIMITS[route], 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  let body: unknown = undefined
  if (schema) {
    const read = await readJsonLimited(req, MAX_BODY_BYTES)
    if (!read.ok) {
      return read.reason === 'too_large'
        ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
        : NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const parsed = schema.safeParse(read.body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    body = parsed.data
  }
  try {
    await ensureSchema()
    const ctx: EngineCtx = { db: getDb(), repo: await getRepositoryAsync(), userId, tz: session.user?.timezone ?? DEFAULT_TZ }
    const result = await run(ctx, body as z.infer<S>)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    if (err instanceof CheckinRefusal) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status, headers: { 'Cache-Control': 'private, no-store' } })
    }
    errorLog(err, `API /weekly-checkin/${route}`)
    return NextResponse.json({ error: 'Weekly check-in failed' }, { status: 500 })
  }
}
