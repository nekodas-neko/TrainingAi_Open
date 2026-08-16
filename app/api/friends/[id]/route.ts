import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { action } = await req.json()
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
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const repo = await getRepositoryAsync()
  await repo.removeFriend(id, session.user.id)
  return new NextResponse(null, { status: 204 })
}
