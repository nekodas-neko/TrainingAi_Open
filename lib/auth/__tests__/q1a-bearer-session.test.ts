/**
 * Q-1a — a session resolved from `Authorization: Bearer <session jwt>`.
 *
 * A native client on a different origin has no cookie to send, so it presents the same NextAuth
 * session JWT as a bearer. The entry's precondition is the whole point of this file: **whatever
 * resolves a bearer must enforce `isActive` itself**, because `middleware.ts`'s 403 gate reads
 * `req.auth` — the cookie session — and structurally cannot see a bearer.
 *
 * ⚠ **The entry's own statement of that failure is half wrong, and this file pins the half that is
 * right.** It says a deactivated bearer holder would reach "every `/api` route" with the 403 never
 * firing. The 403 indeed never fires — but PS-24 moved the real enforcement into `auth()`, which
 * every one of the 222 route files imports and which returns `null` for `isActive === false`. So
 * the answer is 401, not 200, *as long as the bearer is resolved through that wrapper*. Resolving
 * it anywhere else is what would produce the bypass the entry describes.
 *
 * The tokens here are **really encoded and really decrypted** — `encode` from the same module the
 * app decodes with, under the same secret and salt. A mocked decode would pass against an
 * implementation that never verified anything.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { encode } from 'next-auth/jwt'

const SECRET = 'q1a-test-secret-value-long-enough-to-derive'
// `getToken`'s salt defaults to the cookie NAME, and the name depends on NODE_ENV. Getting this
// wrong derives a different key and every valid token reads as invalid — which is why it is stated
// here rather than inherited: the test would still "pass" by rejecting everything.
const SALT = 'authjs.session-token'

process.env.AUTH_SECRET = SECRET

const mint = (claims: Record<string, unknown>) =>
  encode({ token: claims, secret: SECRET, salt: SALT, maxAge: 60 * 60 })

const bearer = (token: string) => new Headers({ authorization: `Bearer ${token}` })

const activeUser = async () => ({ isActive: true, isAdmin: false })
const inactiveUser = async () => ({ isActive: false, isAdmin: false })

describe('bearerSession — the token is really verified', () => {
  it('resolves a signed-in user from the Authorization header', async () => {
    const { bearerSession } = await import('@/lib/auth/bearer-session')
    const session = await bearerSession(bearer(await mint({
      userId: 'u1', isActive: true, timezone: 'Australia/Brisbane',
    })), activeUser)
    expect(session?.user.id).toBe('u1')
    expect(session?.user.timezone).toBe('Australia/Brisbane')
  })

  /** THE case. The claim says active because it was minted before the account was deactivated;
   *  the row says otherwise, and the row is what counts. */
  it('reports isActive false when the ROW says so, whatever the token claims', async () => {
    const { bearerSession } = await import('@/lib/auth/bearer-session')
    const session = await bearerSession(bearer(await mint({
      userId: 'u1', isActive: true,
    })), inactiveUser)
    expect(session?.isActive).toBe(false)
  })

  /** The deliberately equivalent control: the refresh must not flip a live account off. A
   *  resolver that simply reported `isActive: false` would pass the case above. */
  it('leaves an active account active', async () => {
    const { bearerSession } = await import('@/lib/auth/bearer-session')
    const session = await bearerSession(bearer(await mint({
      userId: 'u1', isActive: true,
    })), activeUser)
    expect(session?.isActive).toBe(true)
  })

  it.each([
    ['a token signed with a different secret', async () =>
      encode({ token: { userId: 'u1' }, secret: 'some-other-secret-entirely', salt: SALT, maxAge: 60 })],
    ['a token minted under a different salt', async () =>
      encode({ token: { userId: 'u1' }, secret: SECRET, salt: '__Secure-authjs.session-token', maxAge: 60 })],
  ])('refuses %s', async (_label, make) => {
    const { bearerSession } = await import('@/lib/auth/bearer-session')
    expect(await bearerSession(bearer(await make()), activeUser)).toBeNull()
  })

  it.each([
    ['garbage', 'not-a-jwt-at-all'],
    ['an empty token', ''],
  ])('refuses %s without throwing', async (_label, value) => {
    const { bearerSession } = await import('@/lib/auth/bearer-session')
    expect(await bearerSession(bearer(value), activeUser)).toBeNull()
  })

  it('refuses a request carrying no Authorization header at all', async () => {
    const { bearerSession } = await import('@/lib/auth/bearer-session')
    expect(await bearerSession(new Headers(), activeUser)).toBeNull()
  })

  /** A token that decrypts but carries no subject is not an identity. `userId` is what every route
   *  scopes its queries by, so a session without one is the unscoped-query hazard PS-24 names. */
  it('refuses a valid token that carries no userId', async () => {
    const { bearerSession } = await import('@/lib/auth/bearer-session')
    expect(await bearerSession(bearer(await mint({ isActive: true })), activeUser)).toBeNull()
  })

  /** The claim → session mapping is authConfig's own callback rather than a second copy, so a
   *  claim added there reaches a bearer caller without anyone remembering to update a list. */
  it('carries the same claims a cookie session would', async () => {
    const { bearerSession } = await import('@/lib/auth/bearer-session')
    const session = await bearerSession(bearer(await mint({
      userId: 'u1', isActive: true, friendCode: 'ABC123', equippedTitle: 'iron_will',
    })), activeUser)
    expect(session?.user.friendCode).toBe('ABC123')
    expect(session?.user.equippedTitle).toBe('iron_will')
  })

  /**
   * `isAdmin` is the ROW's, not the token's — the same rule `admin-claim-not-authoritative.test.ts`
   * pins for the cookie path, and it holds here for free because the refresh is shared.
   *
   * This case was written the other way round first and failed, which is what surfaced the point:
   * the fixture minted `isAdmin: true` and let the lookup answer false, and the resolved session
   * said false. That is the resolver being right and the fixture being wrong. Both directions are
   * asserted now, because a resolver that ignored the lookup entirely would satisfy either one
   * alone.
   */
  it.each([
    ['strips an admin claim the row does not back', true, false],
    ['grants admin from the row when the token never claimed it', false, true],
  ])('%s', async (_label, claimed, inRow) => {
    const { bearerSession } = await import('@/lib/auth/bearer-session')
    const session = await bearerSession(
      bearer(await mint({ userId: 'u1', isActive: true, isAdmin: claimed })),
      async () => ({ isActive: true, isAdmin: inRow }),
    )
    expect(session?.user.isAdmin).toBe(inRow)
  })
})

// ── the wrapper ───────────────────────────────────────────────────────────────────────────────

const baseAuth = vi.fn()
const getUserById = vi.fn(async (_id: string) => ({ isActive: true, isAdmin: false }))
let requestHeaders = new Headers()

vi.mock('next-auth', () => ({
  default: vi.fn(() => ({ handlers: {}, auth: baseAuth, signIn: vi.fn(), signOut: vi.fn() })),
}))
vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn(() => ({})) }))
vi.mock('next-auth/providers/google', () => ({ default: vi.fn(() => ({})) }))
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: vi.fn(async () => ({ getUserById: (id: string) => getUserById(id) })),
}))
let headersThrows = false
vi.mock('next/headers', () => ({
  headers: async () => {
    if (headersThrows) throw new Error('called outside a request scope')
    return requestHeaders
  },
}))

describe('auth() — the bearer fallback sits behind the cookie, not beside it', () => {
  beforeEach(() => {
    baseAuth.mockReset()
    getUserById.mockReset()
    getUserById.mockResolvedValue({ isActive: true, isAdmin: false })
    requestHeaders = new Headers()
    headersThrows = false
  })

  it('never looks at the header when the cookie already resolved a session', async () => {
    const cookieSession = { user: { id: 'cookie-user' }, isActive: true }
    baseAuth.mockResolvedValue(cookieSession)
    requestHeaders = bearer(await mint({ userId: 'bearer-user', isActive: true }))
    const { auth } = await import('@/auth')
    // Identity, not equality: a browser request must come back exactly as it did before this
    // existed, and the bearer user must not be able to shadow it.
    expect(await auth()).toBe(cookieSession)
  })

  it('resolves the bearer when the cookie path yields nothing', async () => {
    baseAuth.mockResolvedValue(null)
    requestHeaders = bearer(await mint({ userId: 'bearer-user', isActive: true }))
    const { auth } = await import('@/auth')
    expect((await auth())?.user.id).toBe('bearer-user')
  })

  /** The precondition, stated as the app sees it: a deactivated holder of a still-valid bearer
   *  gets the not-signed-in answer, so a route's `session?.user?.id` guard refuses it. */
  it('refuses a deactivated account holding a valid bearer token', async () => {
    baseAuth.mockResolvedValue(null)
    getUserById.mockResolvedValue({ isActive: false, isAdmin: false })
    requestHeaders = bearer(await mint({ userId: 'bearer-user', isActive: true }))
    const { auth } = await import('@/auth')
    expect(await auth()).toBeNull()
  })

  /** `auth()` is called from places that are not handling an HTTP request, where `headers()`
   *  throws. The app's auth chokepoint must answer "not signed in" there, never throw. */
  it('returns null rather than throwing when there is no request scope', async () => {
    baseAuth.mockResolvedValue(null)
    headersThrows = true
    const { auth } = await import('@/auth')
    expect(await auth()).toBeNull()
  })

  it('still refuses an inactive COOKIE session, which is PS-24 and must not regress', async () => {
    baseAuth.mockResolvedValue({ user: { id: 'u1' }, isActive: false })
    const { auth } = await import('@/auth')
    expect(await auth()).toBeNull()
  })

  /**
   * An inactive cookie session is a **final** answer, not a reason to look further. This case
   * exists because a mutation found the gap: rewriting the guard as
   * `if (session && session.isActive !== false) return session` left every other case passing,
   * since no other test sends a bearer alongside a cookie. Without it, a deactivated browser
   * session carrying any valid bearer would quietly be served as that other identity.
   */
  it('does not fall through to the bearer when the cookie session is inactive', async () => {
    baseAuth.mockResolvedValue({ user: { id: 'deactivated' }, isActive: false })
    requestHeaders = bearer(await mint({ userId: 'someone-else', isActive: true }))
    const { auth } = await import('@/auth')
    expect(await auth()).toBeNull()
    expect(getUserById).not.toHaveBeenCalled()
  })
})
