import { NextRequest, NextResponse } from 'next/server'
import { hashPassword, verifyPassword, validNewPassword, PASSWORD_ERROR } from '@/lib/auth/password'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { freshForFirstPassword, FRESH_SIGN_IN_ERROR } from '@/lib/auth/fresh-sign-in'
import { nowSeconds } from '@/lib/auth/session-cutoff'
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
  } else {
    // #3797: a first password needs a fresh sign-in (`lib/auth/fresh-sign-in.ts`). A native bearer
    // token is re-stamped at every rotation, so its `signedInAt` is not a sign-in time and cannot
    // show freshness: refused, fail closed. Setting a password is a web-screen action.
    const bearer = req.headers.get('authorization')?.toLowerCase().startsWith('bearer ') === true
    if (bearer || !freshForFirstPassword(session.signedInAt, await repo.getLatestIdentityLinkedAt(session.user.id), nowSeconds())) {
      return NextResponse.json({ error: FRESH_SIGN_IN_ERROR, code: 'reauth_required' }, { status: 403 })
    }
  }

  const hash = await hashPassword(newPassword)
  await repo.updateUserPassword(session.user.id, hash)
  return NextResponse.json({ ok: true })
}
