import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`pw-change:${session.user.id}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { currentPassword, newPassword } = await req.json()
  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 })
  }

  const repo = await getRepository()
  const user = await repo.getUserByEmail(session.user.email!)

  // If the account has an existing password, verify it before allowing a change
  if (user?.passwordHash) {
    if (!currentPassword) {
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
