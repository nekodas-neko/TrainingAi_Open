import { NextResponse } from 'next/server'
import { refusalResponse, isRefusal, invalidBodyResponse } from '@/lib/api/route-errors'
import { reportServerError } from '@/lib/observability'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { RequestTraineeBodySchema } from '@trainingai/shared/validation/trainer'

// One email or friend code.
const MAX_BODY_BYTES = 4 * 1024

/** Both sides of the viewer's trainer relationships: who they train, and who trains them. */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`trainer-relationships:${session.user.id}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }
  try {
    const relationships = await (await getRepositoryAsync()).listTrainerRelationships(session.user.id)
    return NextResponse.json(relationships, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e: unknown) {
    if (!isRefusal(e)) reportServerError(e, { userId: session.user.id, url: '/api/trainer/relationships' })
    return refusalResponse(e, 'Could not load trainer relationships')
  }
}

/** Ask someone to be your trainee. They must accept before you can do anything for them. */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 10 per user per 15 minutes — the same budget as friend requests, for the same reason: the
  // 201/404 split is a way to find out which emails and friend codes are registered.
  if (!rateLimit(`trainer-request:${session.user.id}`, 10, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = RequestTraineeBodySchema.safeParse(read.body ?? {})
  if (!parsed.success) return invalidBodyResponse(parsed.error)

  try {
    const relationship = await (await getRepositoryAsync()).requestTrainee(session.user.id, parsed.data.emailOrCode)
    return NextResponse.json({ relationship }, { status: 201 })
  } catch (e: unknown) {
    if (!isRefusal(e)) reportServerError(e, { userId: session.user.id, url: '/api/trainer/relationships' })
    return refusalResponse(e, 'Could not send that request')
  }
}
