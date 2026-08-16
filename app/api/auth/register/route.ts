import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  // 5 registration attempts per IP per 15 minutes
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!rateLimit(`register:${ip}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  const { email, password, name } = await req.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
