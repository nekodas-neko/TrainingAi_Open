// #3949 review S2. During a database fault the active check cannot run, so the request is refused,
// but as "try again" (a JSON 503), never as "signed out" (401). Preview signs out on our own JSON 401
// from `/api/user/profile` and from the refresh route (`mobile/src/features/account/session.ts`),
// so a short outage answered 401 would end the owner's sign-in. Driven through the real `auth()`,
// cookie and bearer, into the routes Preview reads at launch and on foreground, plus the code
// exchange and the admin gate. Nothing may be written during the fault, and the same cookie and token
// pass once the database answers. A signed-out session on a healthy database is still a 401.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { encode } from 'next-auth/jwt'

const SECRET = 'auth-check-unavailable-3949-secret-long-enough'
process.env.AUTH_SECRET = SECRET

const READS = new Set(['getUserById', 'getUserCredentials', 'getUserProviders'])
const db = vi.hoisted(() => ({
  down: false,
  user: null as null | Record<string, unknown>,
  writes: [] as string[],
  cookie: null as null | Record<string, unknown>,
  headers: new Headers(),
  consume: vi.fn(),
}))

vi.mock('next-auth', () => ({
  default: vi.fn(() => ({ handlers: {}, auth: async () => db.cookie, signIn: vi.fn(), signOut: vi.fn() })),
}))
vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn(() => ({})) }))
vi.mock('next-auth/providers/google', () => ({ default: vi.fn(() => ({})) }))
vi.mock('next/headers', () => ({ headers: async () => db.headers }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/auth/mobile/tokens', () => ({ consumeMobileAuthToken: db.consume }))
vi.mock('@/lib/auth/mobile/pkce', () => ({ verifyPkce: () => true }))
vi.mock('@/lib/data', () => {
  // Every read fails while the database is down; anything that is not a known read is recorded as a
  // write, so "nothing persisted" is checked against every method a route could call.
  const repo = new Proxy({}, {
    // Not a thenable: `await getRepository()` would otherwise call `then` and never resolve.
    get: (_t, prop: string) => prop === 'then' ? undefined : async (id: string) => {
      if (!READS.has(prop)) { db.writes.push(prop); return null }
      if (db.down) throw new Error('database offline')
      if (prop === 'getUserProviders') return []
      return db.user && db.user.id === id ? { ...db.user, passwordHash: null } : null
    },
  })
  return { getRepository: async () => repo, getRepositoryAsync: async () => repo }
})

import { GET as profile } from '@/app/api/user/profile/route'
import { GET as dataEpoch } from '@/app/api/account/data-epoch/route'
import { POST as exchange } from '@/app/api/auth/exchange-mobile-token/route'
import { authorizeAdminRequest } from '@/lib/admin/claude-token-auth'

const USER = { id: 'u-3949', email: 'owner@example.invalid', isActive: true, isAdmin: true, timezone: 'Australia/Brisbane', sessionsValidFrom: null, signInsValidFrom: null }
const SIGNED_IN_AT = Math.floor(Date.now() / 1000) - 60

const mint = (claims: Record<string, unknown>) =>
  encode({ token: claims, secret: SECRET, salt: 'authjs.session-token', maxAge: 60 * 60 })

const useCookie = () => {
  db.cookie = { user: { id: USER.id, isAdmin: true }, isActive: true, signedInAt: SIGNED_IN_AT, expires: '' }
  db.headers = new Headers()
}
const useBearer = async () => {
  db.cookie = null
  db.headers = new Headers({ authorization: `Bearer ${await mint({ userId: USER.id, isActive: true, signedInAt: SIGNED_IN_AT })}` })
}
const routes: [string, () => Promise<Response>][] = [
  ['/api/user/profile', () => profile()],
  ['/api/account/data-epoch', () => dataEpoch(new Request('https://example.com/api/account/data-epoch', { headers: db.headers }))],
]

beforeEach(() => {
  db.down = false
  db.user = { ...USER }
  db.writes = []
  db.consume.mockReset()
})

describe.each([['cookie', useCookie], ['bearer', useBearer]] as const)('the %s path', (_label, use) => {
  it.each(routes)('%s answers a JSON 503 during a fault, writes nothing, and 200 once the database is back', async (_path, call) => {
    await use()
    db.down = true
    const down = await call()
    expect(down.status).toBe(503)
    expect(await down.json()).toEqual({ error: expect.stringMatching(/temporarily unavailable/) })
    expect(db.writes).toEqual([])
    db.down = false
    expect((await call()).status).toBe(200)
  })

  it.each(routes)('%s still answers 401 for a session signed out before now, on a healthy database', async (_path, call) => {
    await use()
    db.user = { ...USER, signInsValidFrom: new Date((SIGNED_IN_AT + 30) * 1000) }
    expect((await call()).status).toBe(401)
  })

  it.each(routes)('%s still answers 401 for a deactivated account, on a healthy database', async (_path, call) => {
    await use()
    db.user = { ...USER, isActive: false }
    expect((await call()).status).toBe(401)
  })

})

describe('the admin gate', () => {
  it('answers 503, not 401 or 403, for a cookie session during a fault', async () => {
    useCookie()
    db.down = true
    const outcome = await authorizeAdminRequest(new NextRequest('https://example.com/api/admin/replay'), 'replay-token-3949')
    expect(outcome).toEqual({ ok: false, status: 503, error: 'Service unavailable' })
    expect(db.writes).toEqual([])
  })
})

describe('the native code exchange', () => {
  const post = () => exchange(new NextRequest('https://example.com/api/auth/exchange-mobile-token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 't', verifier: 'v', responseType: 'token' }),
  }))

  it('answers 503, not 401, when the active check cannot run, and issues nothing', async () => {
    db.consume.mockReturnValue({ sessionCookieValue: await mint({ userId: USER.id, isActive: true, signedInAt: SIGNED_IN_AT }), challenge: 'x' })
    db.down = true
    const res = await post()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Sign-in is temporarily unavailable' })
    expect(db.writes).toEqual([])
  })

  it('still answers 401 for a deactivated account on a healthy database', async () => {
    db.consume.mockReturnValue({ sessionCookieValue: await mint({ userId: USER.id, isActive: true, signedInAt: SIGNED_IN_AT }), challenge: 'x' })
    db.user = { ...USER, isActive: false }
    expect((await post()).status).toBe(401)
    expect(db.writes).toEqual([])
  })
})
