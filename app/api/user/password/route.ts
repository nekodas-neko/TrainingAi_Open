import { NextRequest, NextResponse } from 'next/server'
import { hashPassword, verifyPassword, validNewPassword, PASSWORD_ERROR } from '@/lib/auth/password'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
const MAX_BODY_BYTES = 4 * 1024

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`pw-change:${session.user.id}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { currentPassword, newPassword } = (read.body ?? {}) as
    { currentPassword?: unknown; newPassword?: unknown }
  if (!validNewPassword(newPassword)) {
    return NextResponse.json({ error: PASSWORD_ERROR }, { status: 400 })
  }

  const repo = await getRepository()
  const user = await repo.getUserCredentials(session.user.id)
  if (!user) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (user?.passwordHash) {
    if (typeof currentPassword !== 'string' || !currentPassword) {
      return NextResponse.json({ error: 'Current password is required.' }, { status: 400 })
    }
    const valid = await verifyPassword(currentPassword, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 })
    }
  }

  const hash = await hashPassword(newPassword)
  await repo.updateUserPassword(session.user.id, hash)
  return NextResponse.json({ ok: true })
}
