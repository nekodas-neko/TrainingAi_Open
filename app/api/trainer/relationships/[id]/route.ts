import { NextResponse } from 'next/server'
import { refusalResponse, isRefusal, invalidUuidResponse, invalidBodyResponse } from '@/lib/api/route-errors'
import { reportServerError } from '@/lib/observability'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { RelationshipActionBodySchema } from '@trainingai/shared/validation/trainer'

// One action string.
const MAX_BODY_BYTES = 4 * 1024

/**
 * `accept` — only the TRAINEE can; the repository scopes the update to `trainee_id = userId`, so a
 * trainer accepting their own request, or anyone else's, is a 404.
 * `revoke` — either party, pending or accepted. Programs already assigned stay with the trainee.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`trainer-relationship-action:${session.user.id}`, 30, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = RelationshipActionBodySchema.safeParse(read.body ?? {})
  if (!parsed.success) return invalidBodyResponse(parsed.error)

  const repo = await getRepositoryAsync()
  try {
    const relationship = parsed.data.action === 'accept'
      ? await repo.acceptTrainer(id, session.user.id)
      : await repo.revokeTrainerRelationship(id, session.user.id)
    return NextResponse.json({ relationship })
  } catch (e: unknown) {
    if (!isRefusal(e)) reportServerError(e, { userId: session.user.id, url: '/api/trainer/relationships/[id]' })
    return refusalResponse(e, 'Could not update that relationship')
  }
}
