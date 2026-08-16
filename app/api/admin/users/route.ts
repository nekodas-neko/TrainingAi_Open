import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin } from '@/lib/admin'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10) || 100, 200)
    const offset = parseInt(searchParams.get('offset') ?? '0', 10) || 0
    const repo = await getRepository()
    const users = await repo.listUsers(limit, offset)
    return NextResponse.json({ users })
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId, action } = await req.json()
  if (!userId || !['activate', 'deactivate'].includes(action)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const repo = await getRepository()
  if (action === 'activate') {
    await repo.activateUser(userId)
  } else {
    await repo.deactivateUser(userId)
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  if (userId === session.user.id) return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 })

  const repo = await getRepository()
  await repo.deleteUser(userId)
  return NextResponse.json({ ok: true })
}
