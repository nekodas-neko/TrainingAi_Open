import { NextRequest, NextResponse } from 'next/server'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// A user id and a one-word action. 4 KB is generous.
const MAX_BODY_BYTES = 4 * 1024
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'

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
  } catch (err) {
    return adminErrorResponse(err)
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { userId, action } = (read.body ?? {}) as { userId?: unknown; action?: unknown }
  if (typeof userId !== 'string' || typeof action !== 'string' || !['activate', 'deactivate'].includes(action)) {
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
  } catch (err) {
    return adminErrorResponse(err)
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { userId } = (read.body ?? {}) as { userId?: unknown }
  if (typeof userId !== 'string' || !userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  if (userId === session.user.id) return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 })

  const repo = await getRepository()
  await repo.deleteUser(userId)
  return NextResponse.json({ ok: true })
}
