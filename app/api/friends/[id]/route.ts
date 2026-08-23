import { NextResponse } from 'next/server'
import { refusalResponse, isRefusal, invalidUuidResponse } from '@/lib/api/route-errors'
import { reportServerError } from '@/lib/observability'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One action string.
const MAX_BODY_BYTES = 4 * 1024

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { action } = (read.body ?? {}) as { action?: unknown }
  const repo = await getRepositoryAsync()
  try {
    if (action === 'accept') {
      const friendship = await repo.acceptFriendRequest(id, session.user.id)
      return NextResponse.json({ friendship })
    }
    if (action === 'decline') {
      await repo.declineFriendRequest(id, session.user.id)
      return new NextResponse(null, { status: 204 })
    }
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (e: unknown) {
    if (!isRefusal(e)) reportServerError(e, { userId: session.user.id, url: '/api/friends/[id]' })
    return refusalResponse(e, 'Could not update that request')
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  const repo = await getRepositoryAsync()
  await repo.removeFriend(id, session.user.id)
  return new NextResponse(null, { status: 204 })
}
