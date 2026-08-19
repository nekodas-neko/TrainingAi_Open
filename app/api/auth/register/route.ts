import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { clientIp } from '@trainingai/shared/http/client-ip'

// An email, a password capped at 200 characters and a name capped at 100. 8 KB is generous.
const MAX_REGISTER_BODY_BYTES = 8 * 1024

export async function POST(req: NextRequest) {
  // 5 registration attempts per IP per 15 minutes
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
  // Typed explicitly now the body is `unknown` rather than `any`. The regex would have coerced a
  // non-string and failed anyway, so this is the same answer said out loud.
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 })
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    return NextResponse.json({ error: 'Password must be 8–200 characters.' }, { status: 400 })
  }
  if (name != null && (typeof name !== 'string' || name.length > 100)) {
    return NextResponse.json({ error: 'Name too long.' }, { status: 400 })
  }

  const repo = await getRepository()
  const existing = await repo.getUserByEmail(email.toLowerCase().trim())
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
  }

  const passwordHash = await bcrypt.hash(password, 12)
  await repo.createEmailUser(email.toLowerCase().trim(), passwordHash, name ?? undefined)

  return NextResponse.json({ ok: true })
}
