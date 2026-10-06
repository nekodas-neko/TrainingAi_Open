import { describe, it, expect, vi, beforeEach } from 'vitest'
import { encode } from 'next-auth/jwt'

const SECRET = 'q1a-test-secret-value-long-enough-to-derive'
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


  it('reports isActive false when the ROW says so, whatever the token claims', async () => {
    const { bearerSession } = await import('@/lib/auth/bearer-session')
    const session = await bearerSession(bearer(await mint({
      userId: 'u1', isActive: true,
    })), inactiveUser)
    expect(session?.isActive).toBe(false)
  })


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


  it('refuses a valid token that carries no userId', async () => {
    const { bearerSession } = await import('@/lib/auth/bearer-session')
    expect(await bearerSession(bearer(await mint({ isActive: true })), activeUser)).toBeNull()
  })


  it('carries the same claims a cookie session would', async () => {
    const { bearerSession } = await import('@/lib/auth/bearer-session')
    const session = await bearerSession(bearer(await mint({
      userId: 'u1', isActive: true, friendCode: 'ABC123', equippedTitle: 'iron_will',
    })), activeUser)
    expect(session?.user.friendCode).toBe('ABC123')
    expect(session?.user.equippedTitle).toBe('iron_will')
  })


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

const baseAuth = vi.fn()
const getUserById = vi.fn<(userId: string) => Promise<{ isActive: boolean; isAdmin: boolean }>>(
  async () => ({ isActive: true, isAdmin: false }),
)
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
    expect(await auth()).toBe(cookieSession)
  })

  it.each([true, false])('preserves a cookie with isActive=%s during a database outage', async isActive => {
    const cookieSession = { user: { id: 'cookie-user', isAdmin: true }, isActive }
    baseAuth.mockResolvedValue(cookieSession)
    getUserById.mockRejectedValue(new Error('db down'))
    const { auth } = await import('@/auth')
    await expect(auth()).resolves.toBe(isActive ? cookieSession : null)
    expect(cookieSession.user.isAdmin).toBe(true)
  })

  it.each([true, false])('preserves a bearer with isActive=%s during a database outage', async isActive => {
    baseAuth.mockResolvedValue(null)
    requestHeaders = bearer(await mint({ userId: 'bearer-user', isActive, isAdmin: true }))
    getUserById.mockRejectedValue(new Error('db down'))
    const { auth } = await import('@/auth')
    const session = await auth()
    if (isActive) {
      expect(session?.user.id).toBe('bearer-user')
      expect(session?.isActive).toBe(true)
      expect(session?.user.isAdmin).toBe(true)
    } else {
      expect(session).toBeNull()
    }
  })

  it('resolves the bearer when the cookie path yields nothing', async () => {
    baseAuth.mockResolvedValue(null)
    requestHeaders = bearer(await mint({ userId: 'bearer-user', isActive: true }))
    const { auth } = await import('@/auth')
    expect((await auth())?.user.id).toBe('bearer-user')
  })


  it('refuses a deactivated account holding a valid bearer token', async () => {
    baseAuth.mockResolvedValue(null)
    getUserById.mockResolvedValue({ isActive: false, isAdmin: false })
    requestHeaders = bearer(await mint({ userId: 'bearer-user', isActive: true }))
    const { auth } = await import('@/auth')
    expect(await auth()).toBeNull()
  })


  it('returns null rather than throwing when there is no request scope', async () => {
    baseAuth.mockResolvedValue(null)
    headersThrows = true
    const { auth } = await import('@/auth')
    expect(await auth()).toBeNull()
  })

  it('still refuses an inactive COOKIE session, which is PS-24 and must not regress', async () => {
    getUserById.mockResolvedValue({ isActive: false, isAdmin: false })
    baseAuth.mockResolvedValue({ user: { id: 'u1' }, isActive: false })
    const { auth } = await import('@/auth')
    expect(await auth()).toBeNull()
  })


  it('does not fall through to the bearer when the cookie session is inactive', async () => {
    getUserById.mockResolvedValue({ isActive: false, isAdmin: false })
    baseAuth.mockResolvedValue({ user: { id: 'deactivated' }, isActive: false })
    requestHeaders = bearer(await mint({ userId: 'someone-else', isActive: true }))
    const { auth } = await import('@/auth')
    expect(await auth()).toBeNull()
    expect(getUserById).toHaveBeenCalledWith('deactivated')
    expect(getUserById).not.toHaveBeenCalledWith('someone-else')
  })
})
