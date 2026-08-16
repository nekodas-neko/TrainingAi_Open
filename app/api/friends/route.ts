import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'

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

  const { emailOrCode } = await req.json()
  if (!emailOrCode || typeof emailOrCode !== 'string') {
    return NextResponse.json({ error: 'emailOrCode required' }, { status: 400 })
  }
  const repo = await getRepositoryAsync()
  try {
    const friendship = await repo.sendFriendRequest(session.user.id, emailOrCode.trim())
    return NextResponse.json({ friendship }, { status: 201 })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
