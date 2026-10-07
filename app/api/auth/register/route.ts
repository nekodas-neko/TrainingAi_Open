import { NextRequest, NextResponse } from 'next/server'
import { hashPassword, validNewPassword, PASSWORD_ERROR } from '@/lib/auth/password'
import { normalizeEmail } from '@trainingai/shared/validation/email'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { clientIp } from '@trainingai/shared/http/client-ip'
const MAX_REGISTER_BODY_BYTES = 8 * 1024

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  if (!rateLimit(`register:${ip}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_REGISTER_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { email, password, name } = (read.body ?? {}) as { email?: unknown; password?: unknown; name?: unknown }

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
  }
  if (typeof email !== 'string' || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 })
  }
  if (!validNewPassword(password)) {
    return NextResponse.json({ error: PASSWORD_ERROR }, { status: 400 })
  }
  if (name != null && (typeof name !== 'string' || name.length > 100)) {
    return NextResponse.json({ error: 'Name too long.' }, { status: 400 })
  }

  const repo = await getRepository()
  const existing = await repo.getUserByEmail(normalizeEmail(email))
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
  }

  const passwordHash = await hashPassword(password)
  await repo.createEmailUser(normalizeEmail(email), passwordHash, name ?? undefined)

  return NextResponse.json({ ok: true })
}
