import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// Two passwords. The route's own floor is 8 characters and nothing caps the top, but bcrypt only
// consumes the first 72 bytes, so 4 KB is generous past any usable input.
const MAX_BODY_BYTES = 4 * 1024

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`pw-change:${session.user.id}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // Bare `req.json()` also threw on malformed JSON, which Next answered as a 500 on a credential
  // route. `readJsonLimited` answers 400.
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { currentPassword, newPassword } = (read.body ?? {}) as
    { currentPassword?: unknown; newPassword?: unknown }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 })
  }

  const repo = await getRepository()
  const user = await repo.getUserByEmail(session.user.email!)

  // If the account has an existing password, verify it before allowing a change
  if (user?.passwordHash) {
    if (typeof currentPassword !== 'string' || !currentPassword) {
      return NextResponse.json({ error: 'Current password is required.' }, { status: 400 })
    }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 })
    }
  }

  const hash = await bcrypt.hash(newPassword, 12)
  await repo.updateUserPassword(session.user.id, hash)
  return NextResponse.json({ ok: true })
}
