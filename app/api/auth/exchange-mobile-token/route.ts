import { NextRequest, NextResponse } from 'next/server'
import { sessionTokenFrom } from '@/lib/auth/session-token'
import { refreshIsActiveClaim } from '@/lib/auth/is-active-refresh'
import { getRepositoryAsync } from '@/lib/data'
import { consumeMobileAuthToken } from '@/lib/auth/mobile/tokens'
import { verifyPkce } from '@/lib/auth/mobile/pkce'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { clientIp } from '@trainingai/shared/http/client-ip'

const MAX_EXCHANGE_BODY_BYTES = 8 * 1024
const COOKIE_CHUNK_SIZE = 3936

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest) {
  if (!rateLimit(`mobile-token:${clientIp(req)}`, 10, 5 * 60 * 1000)) {
    return json({ error: 'Too many requests' }, 429)
  }
  const read = await readJsonLimited(req, MAX_EXCHANGE_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? json({ error: 'Request too large' }, 413)
      : json({ error: 'Missing token or verifier' }, 400)
  }
  const body = read.body as { token?: unknown; verifier?: unknown; responseType?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token : undefined
  const verifier = typeof body?.verifier === 'string' ? body.verifier : undefined
  if (!token || !verifier) {
    return json({ error: 'Missing token or verifier' }, 400)
  }
  if (body?.responseType !== undefined && body.responseType !== 'cookie' && body.responseType !== 'token') {
    return json({ error: 'Invalid response type' }, 400)
  }
  const entry = consumeMobileAuthToken(token)
  if (!entry || !verifyPkce(verifier, entry.challenge)) {
    return json({ error: 'Invalid or expired token' }, 401)
  }
  const session = await sessionTokenFrom(new Headers({ authorization: `Bearer ${entry.sessionCookieValue}` }))
  const now = Math.floor(Date.now() / 1000)
  if (!session?.userId || typeof session.exp !== 'number' || session.exp <= now) {
    return json({ error: 'Invalid or expired session' }, 401)
  }
  await refreshIsActiveClaim(session, async userId => (await getRepositoryAsync()).getUserById(userId))
  if (!session.isActive) {
    return json({ error: 'Invalid or expired session' }, 401)
  }
  if (body?.responseType === 'token') {
    return json({ ok: true, accessToken: entry.sessionCookieValue, tokenType: 'Bearer', expiresAt: session.exp })
  }

  const secure = process.env.NODE_ENV === 'production'
  const name = secure ? '__Secure-authjs.session-token' : 'authjs.session-token'
  const res = json({ ok: true })
  for (const cookie of req.cookies.getAll()) {
    if (cookie.name === name || cookie.name.startsWith(`${name}.`)) {
      res.cookies.set(cookie.name, '', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0 })
    }
  }
  const value = entry.sessionCookieValue
  const count = Math.ceil(value.length / COOKIE_CHUNK_SIZE)
  for (let i = 0; i < count; i++) {
    res.cookies.set(count > 1 ? `${name}.${i}` : name, value.slice(i * COOKIE_CHUNK_SIZE, (i + 1) * COOKIE_CHUNK_SIZE), {
      httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: session.exp - now,
    })
  }
  return res
}
