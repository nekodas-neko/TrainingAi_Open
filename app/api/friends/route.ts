import { NextResponse } from 'next/server'
import { refusalResponse, isRefusal } from '@/lib/api/route-errors'
import { reportServerError } from '@/lib/observability'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One email or friend code.
const MAX_BODY_BYTES = 4 * 1024

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const repo = await getRepositoryAsync()
  const friendships = await repo.listFriendships(session.user.id)
  return NextResponse.json({ friendships }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 10 friend-request attempts per user per 15 minutes — limits how fast an
  // account can be used to enumerate registered emails via the 201/400 split
  // in sendFriendRequest below.
  if (!rateLimit(`friend-request:${session.user.id}`, 10, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { emailOrCode } = (read.body ?? {}) as { emailOrCode?: unknown }
  if (!emailOrCode || typeof emailOrCode !== 'string') {
    return NextResponse.json({ error: 'emailOrCode required' }, { status: 400 })
  }
  const repo = await getRepositoryAsync()
  try {
    const friendship = await repo.sendFriendRequest(session.user.id, emailOrCode.trim())
    return NextResponse.json({ friendship }, { status: 201 })
  } catch (e: unknown) {
    if (!isRefusal(e)) reportServerError(e, { userId: session.user.id, url: '/api/friends' })
    return refusalResponse(e, 'Could not send that request')
  }
}
