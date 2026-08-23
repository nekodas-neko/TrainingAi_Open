import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getDb, ensureSchema } from '@/lib/data/postgres/client'
import { rateLimit } from '@/lib/rate-limit'
import { CoachPatchSchema } from '@/lib/coach/patch'
import { previewPatch } from '@/lib/coach/consequences'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'
import { errorLog } from '@trainingai/shared/logger'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// The same patch shape coach/apply takes.
const MAX_BODY_BYTES = 256 * 1024

/**
 * What a proposed change would cost, measured against the real rows.
 *
 * This exists so the model cannot author a consequence. `proposeChange` is a client-side tool
 * with no `execute`, so its arguments come straight from the model — which is fine for the patch
 * (the user sees and confirms every field) and unacceptable for a claim like "this drops your
 * weekly lower-back sets", which the user has no way to check. The model proposes; this measures;
 * the widget renders the measurement.
 *
 * It also returns drift, so a stale proposal says so on render rather than only on Apply.
 */
export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`${userId}:coach-preview`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const parsed = CoachPatchSchema.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid patch' }, { status: 400 })

  try {
    await ensureSchema()
    const result = await previewPatch(
      getDb(),
      userId,
      parsed.data,
      todayInTz(session.user?.timezone ?? DEFAULT_TZ),
      session.user?.timezone ?? DEFAULT_TZ,
    )
    if (!result.target) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(result)
  } catch (error) {
    errorLog(error, 'API /coach/preview')
    return NextResponse.json({ error: 'Preview failed' }, { status: 500 })
  }
}
