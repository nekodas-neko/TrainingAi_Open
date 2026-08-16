import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  sessionCookieFromHeader,
  userIdFromSessionCookie,
  shouldRecordRequestError,
  resetRequestErrorDedupe,
} from '@/lib/observability/request-error'

/**
 * Q-145: every row from the `onRequestError` path was written with `user_id = NULL`, so the
 * largest class of server errors — the 80 route files with no `catch` of their own — was
 * unattributable, and the 60 s dedup on `url|message` silently collapsed two users' identical
 * faults into one row.
 *
 * The entry recorded this as **not implementable**, on the grounds that Next hands the hook only
 * `{ path, method }`. That was the repo's own narrowed local type being read as if it were Next's:
 * `InstrumentationOnRequestError` in `next/dist/server/instrumentation/types.d.ts` passes
 * `{ path, method, headers }`, and the session cookie is in there.
 *
 * The decrypt round-trips through Auth.js's own `encode`, so this fails if Auth.js changes its
 * token format or salt convention — which is the thing most likely to break it silently.
 */

const SECRET = 'test-secret-for-request-error-attribution-0123456789'
const USER_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

let originalSecret: string | undefined

beforeEach(() => {
  resetRequestErrorDedupe()
  originalSecret = process.env.AUTH_SECRET
  process.env.AUTH_SECRET = SECRET
})

afterEach(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = originalSecret
})

async function encodeSession(payload: Record<string, unknown>, salt: string): Promise<string> {
  const { encode } = await import('next-auth/jwt')
  return encode({ token: payload, secret: SECRET, salt, maxAge: 3600 })
}

describe('sessionCookieFromHeader', () => {
  it('finds the plain cookie', () => {
    expect(sessionCookieFromHeader('authjs.session-token=abc'))
      .toEqual({ name: 'authjs.session-token', value: 'abc' })
  })

  it('finds the __Secure- cookie among others, keeping its exact name', () => {
    // The name is the decrypt salt, so returning the unprefixed one here would decrypt to nothing.
    expect(sessionCookieFromHeader('theme=dark; __Secure-authjs.session-token=xyz; other=1'))
      .toEqual({ name: '__Secure-authjs.session-token', value: 'xyz' })
  })

  it('returns null for no cookie, an empty value, or an unrelated cookie', () => {
    expect(sessionCookieFromHeader(undefined)).toBeNull()
    expect(sessionCookieFromHeader('')).toBeNull()
    expect(sessionCookieFromHeader('theme=dark')).toBeNull()
    expect(sessionCookieFromHeader('authjs.session-token=')).toBeNull()
  })

  it('is not fooled by a cookie whose name merely contains the session name', () => {
    expect(sessionCookieFromHeader('not-authjs.session-token=abc')).toBeNull()
  })
})

describe('userIdFromSessionCookie', () => {
  it('reads the id from a token Auth.js itself produced', async () => {
    const salt = 'authjs.session-token'
    const token = await encodeSession({ id: USER_ID, sub: USER_ID }, salt)
    expect(await userIdFromSessionCookie(`${salt}=${encodeURIComponent(token)}`)).toBe(USER_ID)
  })

  it('falls back to sub when id is absent', async () => {
    const salt = 'authjs.session-token'
    const token = await encodeSession({ sub: USER_ID }, salt)
    expect(await userIdFromSessionCookie(`${salt}=${encodeURIComponent(token)}`)).toBe(USER_ID)
  })

  it('works under the __Secure- name production actually uses', async () => {
    const salt = '__Secure-authjs.session-token'
    const token = await encodeSession({ id: USER_ID }, salt)
    expect(await userIdFromSessionCookie(`${salt}=${encodeURIComponent(token)}`)).toBe(USER_ID)
  })

  // Every one of these must be null rather than a throw: this runs inside the error path, and a
  // failure to attribute must never replace the error being reported.
  it('returns null rather than throwing on anything it cannot read', async () => {
    const salt = 'authjs.session-token'
    const good = await encodeSession({ id: USER_ID }, salt)

    expect(await userIdFromSessionCookie(undefined)).toBeNull()
    expect(await userIdFromSessionCookie('theme=dark')).toBeNull()
    expect(await userIdFromSessionCookie(`${salt}=not-a-jwe`)).toBeNull()
    // Wrong salt — the token is valid but was minted under the other cookie name.
    expect(await userIdFromSessionCookie(`__Secure-${salt}=${encodeURIComponent(good)}`)).toBeNull()

    process.env.AUTH_SECRET = 'a-different-secret-entirely-9876543210abcdef'
    expect(await userIdFromSessionCookie(`${salt}=${encodeURIComponent(good)}`)).toBeNull()

    delete process.env.AUTH_SECRET
    expect(await userIdFromSessionCookie(`${salt}=${encodeURIComponent(good)}`)).toBeNull()
  })

  it('rejects a non-UUID subject', async () => {
    // `error_events.user_id` is a `uuid` column with an FK. A non-UUID subject reaching the INSERT
    // would fail it and lose the error row — the opposite of what this feature is for.
    const salt = 'authjs.session-token'
    const token = await encodeSession({ id: 'not-a-uuid', sub: 'also-not' }, salt)
    expect(await userIdFromSessionCookie(`${salt}=${encodeURIComponent(token)}`)).toBeNull()
  })
})

describe('dedup key is user-scoped', () => {
  it('no longer collapses two users hitting the same fault', () => {
    const a = '11111111-1111-4111-8111-111111111111'
    const b = '22222222-2222-4222-8222-222222222222'
    expect(shouldRecordRequestError(`${a}|GET /api/x|boom`, 1_000)).toBe(true)
    expect(shouldRecordRequestError(`${b}|GET /api/x|boom`, 1_000)).toBe(true)
  })

  it("still suppresses one user's own repeat inside the window", () => {
    const a = '11111111-1111-4111-8111-111111111111'
    expect(shouldRecordRequestError(`${a}|GET /api/x|boom`, 1_000)).toBe(true)
    expect(shouldRecordRequestError(`${a}|GET /api/x|boom`, 1_000 + 59_999)).toBe(false)
  })

  it('keeps anonymous requests sharing one slot, as before', () => {
    expect(shouldRecordRequestError(`|GET /api/x|boom`, 1_000)).toBe(true)
    expect(shouldRecordRequestError(`|GET /api/x|boom`, 1_000 + 100)).toBe(false)
  })
})
