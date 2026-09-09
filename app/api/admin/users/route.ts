import { NextRequest, NextResponse } from 'next/server'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// A user id and a one-word action. 4 KB is generous.
const MAX_BODY_BYTES = 4 * 1024
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { invalidUuidResponse } from '@/lib/api/route-errors'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Q-548 — the check answers 403 or 503; the listing is outside it, so a failed query surfaces as
  // the fault it is rather than as a revoked credential.
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10) || 100, 200)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10) || 0
  const repo = await getRepository()
  const users = await repo.listUsers(limit, offset)
  return NextResponse.json({ users })
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
  // RV-47: `users.id` is a uuid, so a malformed one reached the driver as a 22P02 and answered 500
  // with an empty body, filing the failing UPDATE statement into `error_events` as a server fault.
  const badId = invalidUuidResponse(userId)
  if (badId) return badId

  const repo = await getRepository()
  // RV-48: an id that matched no user answered `200 {"ok":true}`, the same response a real
  // activation gives.
  const changed = action === 'activate'
    ? await repo.activateUser(userId)
    : await repo.deactivateUser(userId)
  if (!changed) return NextResponse.json({ error: 'User not found' }, { status: 404 })
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
  const badId = invalidUuidResponse(userId)
  if (badId) return badId
  if (userId === session.user.id) return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 })

  const repo = await getRepository()
  const deleted = await repo.deleteUser(userId)
  if (!deleted) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
