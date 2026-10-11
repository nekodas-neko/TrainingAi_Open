import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const getUserById = vi.fn(async () => ({ isActive: true, isAdmin: false }))
const sessionTokenFrom = vi.fn(async () => ({ userId: 'u-1', exp: Math.floor(Date.now() / 1000) + 3600 }) as { userId: string; exp: number } | null)

const getUserCredentials = vi.fn(async (_e: string) => userRow() as Row | null)
const updateUserPassword = vi.fn(async (_u: string, _h: string) => undefined)
const updateUserProfile = vi.fn(async (_u: string, _p: Row) => ({ id: 'u-1', displayName: 'Sam' }) as Row)
const updateUserAvatar = vi.fn(async (_u: string, _a: string) => ({ avatar: 'stored.png' }) as Row)
const countWorkoutSessions = vi.fn(async (_u: string) => 42)
const getUserPreferences = vi.fn(async (_u: string) => ({ scoreRingStyle: 'solid' }) as Row)
const updateUserPreferences = vi.fn(async (_u: string, _p: Row) => ({ scoreRingStyle: 'solid' }) as Row)
const consumeMobileAuthToken = vi.fn((_t: string) => null as { challenge: string; sessionCookieValue: string } | null)
const verifyPkce = vi.fn((_v: string, _c: string) => true)
const bcryptCompare = vi.fn(async (_p: string, _h: string) => true)
const bcryptHash = vi.fn(async (_p: string, _r: number) => 'hashed:' + _r)

let sessionUser: { id: string; email?: string } | null = { id: 'u-1', email: 'me@example.com' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getUserCredentials, getUserById, updateUserPassword, updateUserProfile, updateUserAvatar,
    countWorkoutSessions, getUserPreferences, updateUserPreferences, getUserProviders: async () => ['google'],
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('bcryptjs', () => ({
  default: {
    compare: (p: string, h: string) => bcryptCompare(p, h),
    hash: (p: string, r: number) => bcryptHash(p, r),
  },
}))
vi.mock('@/lib/auth/mobile/tokens', () => ({ consumeMobileAuthToken: (t: string) => consumeMobileAuthToken(t) }))
vi.mock('@/lib/auth/mobile/pkce', () => ({ verifyPkce: (v: string, c: string) => verifyPkce(v, c) }))

import { PATCH as changePassword } from '@/app/api/user/password/route'
import { GET as readProfile, PATCH as patchProfile } from '@/app/api/user/profile/route'
import { GET as readPreferences, PATCH as patchPreferences } from '@/app/api/user/preferences/route'
import { POST as uploadAvatar } from '@/app/api/user/avatar/route'
vi.mock('@/lib/auth/session-token', () => ({
  sessionTokenFrom: (_headers: Headers) => sessionTokenFrom(),
}))

import { POST as exchangeToken } from '@/app/api/auth/exchange-mobile-token/route'

const userRow = (over: Row = {}) => ({
  id: 'u-1', email: 'me@example.com', name: 'Sam', displayName: 'Sam',
  passwordHash: '$2b$12$aRealLookingBcryptHashThatMustNeverLeak',
  heightCm: 180, timezone: 'Australia/Brisbane', ...over,
})

const send = (
  handler: (req: never) => Promise<Response>, url: string, method: string, body: unknown,
  headers: Record<string, string> = {},
) => handler(Object.assign(new Request(`http://localhost${url}`, {
  method, headers: { 'Content-Type': 'application/json', ...headers },
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
}), { nextUrl: new URL(`http://localhost${url}`), cookies: { getAll: () => [] } }) as never)

const password = (body: unknown) => send(changePassword as never, '/api/user/password', 'PATCH', body)
const profilePatch = (body: unknown) => send(patchProfile as never, '/api/user/profile', 'PATCH', body)
const prefsPatch = (body: unknown) => send(patchPreferences as never, '/api/user/preferences', 'PATCH', body)
const avatar = (body: unknown) => send(uploadAvatar as never, '/api/user/avatar', 'POST', body)
const exchange = (body: unknown, headers: Record<string, string> = {}) =>
  send(exchangeToken as never, '/api/auth/exchange-mobile-token', 'POST', body, headers)

let seq = 0

const freshUser = () => { sessionUser = { id: `u-${++seq}`, email: `u${seq}@example.com` } }
const me = () => sessionUser!.id

let ipSeq = 0
const freshIp = () => ({ 'x-forwarded-for': `10.0.0.${++ipSeq}` })

beforeEach(() => {
  vi.clearAllMocks()
  freshUser()
  getUserById.mockResolvedValue({ isActive: true, isAdmin: false })
  sessionTokenFrom.mockResolvedValue({ userId: 'u-1', exp: Math.floor(Date.now() / 1000) + 3600 })
  getUserCredentials.mockResolvedValue(userRow())
  updateUserProfile.mockResolvedValue({ id: 'u-1', displayName: 'Sam' })
  updateUserAvatar.mockResolvedValue({ avatar: 'stored.png' })
  countWorkoutSessions.mockResolvedValue(42)
  getUserPreferences.mockResolvedValue({ scoreRingStyle: 'solid' })
  updateUserPreferences.mockResolvedValue({ scoreRingStyle: 'solid' })
  bcryptCompare.mockResolvedValue(true)
  bcryptHash.mockResolvedValue('hashed:12')
  verifyPkce.mockReturnValue(true)
  consumeMobileAuthToken.mockReturnValue(null)
})

describe('PATCH /api/user/password', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await password({ currentPassword: 'a', newPassword: 'longenough' })).status).toBe(401)
  })
  it('answers 400 to a malformed body, not 500', async () => {
    const res = await password('{not json')
    expect(res.status).toBe(400)
    expect(updateUserPassword).not.toHaveBeenCalled()
  })

  it('refuses an oversized body', async () => {
    expect((await password({ newPassword: 'x'.repeat(8 * 1024) })).status).toBe(413)
  })

  it('enforces the eight-character floor before reading anything', async () => {
    for (const newPassword of ['short', '', 1234567890, null, undefined]) {
      const res = await password({ currentPassword: 'old', newPassword })
      expect(res.status).toBe(400)
    }
    expect(getUserCredentials).not.toHaveBeenCalled()
    expect(updateUserPassword).not.toHaveBeenCalled()
  })

  it('uses the session ID even when no email claim exists', async () => {
    sessionUser = { id: 'id-only-account' }
    getUserCredentials.mockResolvedValue(userRow({ passwordHash: null }))
    expect((await password({ newPassword: 'longenough' })).status).toBe(200)
    expect(getUserCredentials).toHaveBeenCalledWith('id-only-account')
    expect(updateUserPassword).toHaveBeenCalledWith('id-only-account', 'hashed:12')
  })

  it('refuses a password bcrypt would truncate', async () => {
    for (const newPassword of ['a'.repeat(73), '🔒'.repeat(19)]) {
      expect((await password({ newPassword })).status).toBe(400)
    }
    expect(updateUserPassword).not.toHaveBeenCalled()
  })

  it('does not set a password for a missing account', async () => {
    getUserCredentials.mockResolvedValue(null)
    expect((await password({ newPassword: 'longenough' })).status).toBe(404)
    expect(updateUserPassword).not.toHaveBeenCalled()
  })

  it('requires the current password when the account has one, and verifies it', async () => {
    expect((await password({ newPassword: 'longenough' })).status).toBe(400)
    expect((await password({ currentPassword: '', newPassword: 'longenough' })).status).toBe(400)
    expect(updateUserPassword).not.toHaveBeenCalled()

    bcryptCompare.mockResolvedValue(false)
    const wrong = await password({ currentPassword: 'guess', newPassword: 'longenough' })
    expect(wrong.status).toBe(400)
    expect(await wrong.json()).toEqual({ error: 'Current password is incorrect.' })
    expect(updateUserPassword).not.toHaveBeenCalled()

    bcryptCompare.mockResolvedValue(true)
    expect((await password({ currentPassword: 'right', newPassword: 'longenough' })).status).toBe(200)
    expect(bcryptCompare).toHaveBeenLastCalledWith('right', userRow().passwordHash)
  })
  it('lets an account with no password set one without a current password', async () => {
    getUserCredentials.mockResolvedValue(userRow({ passwordHash: null }))
    expect((await password({ newPassword: 'longenough' })).status).toBe(200)
    expect(bcryptCompare).not.toHaveBeenCalled()
    expect(updateUserPassword).toHaveBeenCalledTimes(1)
  })

  it('stores a hash for the session user, never the plaintext', async () => {
    await password({ currentPassword: 'right', newPassword: 'a-good-password' })
    const [userId, stored] = updateUserPassword.mock.calls[0]
    expect(userId).toBe(me())
    expect(stored).not.toContain('a-good-password')
    expect(bcryptHash).toHaveBeenCalledWith('a-good-password', 12)
  })

  it('rate-limits the sixth change in the hour', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await password({ currentPassword: 'r', newPassword: 'longenough' })).status).toBe(200)
    }
    expect((await password({ currentPassword: 'r', newPassword: 'longenough' })).status).toBe(429)
  })
})

describe('/api/user/profile', () => {
  it('refuses both verbs without a session', async () => {
    sessionUser = null
    expect((await readProfile()).status).toBe(401)
    expect((await profilePatch({ displayName: 'Sam' })).status).toBe(401)
  })
  it('never returns the password hash, only whether one exists', async () => {
    const body = await (await readProfile()).json()
    expect(body.hasPassword).toBe(true)
    expect(body.user).not.toHaveProperty('passwordHash')
    expect(JSON.stringify(body)).not.toContain('$2b$12$')
    expect(body).not.toHaveProperty('workoutCount')
    expect(countWorkoutSessions).not.toHaveBeenCalled()

    getUserCredentials.mockResolvedValue(userRow({ passwordHash: null }))
    expect((await (await readProfile()).json()).hasPassword).toBe(false)
  })

  it('404s when the session names a user the repository cannot find', async () => {
    getUserCredentials.mockResolvedValue(null)
    expect((await readProfile()).status).toBe(404)
  })

  it('rejects an unknown key and an out-of-range value', async () => {
    expect((await profilePatch({ displayName: 'Sam', isAdmin: true })).status).toBe(400)
    expect((await profilePatch({ heightCm: 1000 })).status).toBe(400)
    expect((await profilePatch({ dateOfBirth: '15/06/1993' })).status).toBe(400)
    expect((await profilePatch({ sex: 'unspecified' })).status).toBe(400)
    expect(updateUserProfile).not.toHaveBeenCalled()
  })
  it('keeps "omitted" and "explicitly null" different', async () => {
    await profilePatch({ displayName: 'Sam' })
    expect(updateUserProfile.mock.calls[0][1]).toEqual({ displayName: 'Sam' })

    updateUserProfile.mockClear()
    await profilePatch({ heightCm: null })
    expect(updateUserProfile.mock.calls[0][1]).toEqual({ heightCm: null })

    updateUserProfile.mockClear()
    await profilePatch({})
    expect(updateUserProfile.mock.calls[0][1]).toEqual({})
  })

  it('writes to the session user, whatever the body says', async () => {
    await profilePatch({ displayName: 'Sam' })
    expect(updateUserProfile.mock.calls[0][0]).toBe(me())
  })
})

describe('/api/user/preferences', () => {
  it('refuses both verbs without a session', async () => {
    sessionUser = null
    expect((await readPreferences()).status).toBe(401)
    expect((await prefsPatch({ scoreRingStyle: 'solid' })).status).toBe(401)
  })

  it('reads and writes the caller\'s own bag, uncacheable', async () => {
    const res = await readPreferences()
    expect(getUserPreferences).toHaveBeenCalledWith(me())
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect((await prefsPatch({ scoreRingStyle: 'solid' })).headers.get('Cache-Control'))
      .toBe('private, no-store')
  })

  it('rejects an unknown preference key rather than storing it', async () => {
    const res = await prefsPatch({ scoreRingStyle: 'solid', rootAccess: true })
    expect(res.status).toBe(400)
    expect(updateUserPreferences).not.toHaveBeenCalled()
  })

  it('rejects a value the schema bounds', async () => {
    expect((await prefsPatch({ weightLookback: 99999 })).status).toBe(400)
  })
  it('forwards an explicit null to clear a key, and nothing at all when the body is empty', async () => {
    await prefsPatch({ scoreRingStyle: null })
    expect(updateUserPreferences.mock.calls[0][1]).toEqual({ scoreRingStyle: null })

    updateUserPreferences.mockClear()
    await prefsPatch({})
    expect(updateUserPreferences.mock.calls[0][1]).toEqual({})
  })

  it('returns the merged bag, so the caller learns what another device set', async () => {
    updateUserPreferences.mockResolvedValue({ scoreRingStyle: 'solid', weightLookback: 30 })
    const body = await (await prefsPatch({ scoreRingStyle: 'solid' })).json()
    expect(body).toEqual({ scoreRingStyle: 'solid', weightLookback: 30 })
  })
})

describe('POST /api/user/avatar', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAAN' + 'A'.repeat(100)

  it('refuses without a session', async () => {
    sessionUser = null
    expect((await avatar({ avatar: PNG })).status).toBe(401)
  })

  it('requires an avatar string', async () => {
    expect((await avatar({})).status).toBe(400)
    expect((await avatar({ avatar: 42 })).status).toBe(400)
    expect(updateUserAvatar).not.toHaveBeenCalled()
  })
  it('refuses SVG and anything else outside the whitelist', async () => {
    for (const bad of [
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:application/octet-stream;base64,AAAA',
      'https://example.com/avatar.png',
      'data:image/gif;base64,AAAA',
    ]) {
      const res = await avatar({ avatar: bad })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/Unsupported image type|Missing avatar/)
    }
    expect(updateUserAvatar).not.toHaveBeenCalled()
  })
  const REAL_HEADER: Record<string, string> = {
    'image/png': 'iVBORw0KGgoAAAAN',
    'image/jpeg': '/9j/4AAQSkY=',
    'image/webp': 'UklGRgQAAABXRUJQ',
  }

  it('accepts the three whitelisted types', async () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
      expect((await avatar({ avatar: `data:${mime};base64,${REAL_HEADER[mime]}` })).status).toBe(200)
    }
    expect(updateUserAvatar).toHaveBeenCalledTimes(3)
  })

  it('rejects bytes that are not the type the data URI declares', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64')
    const res = await avatar({ avatar: `data:image/png;base64,${svg}` })
    expect(res.status).toBe(400)
    expect(updateUserAvatar).not.toHaveBeenCalled()
  })

  it('rejects a real image whose declared type is a different real image type', async () => {
    const res = await avatar({ avatar: `data:image/png;base64,${REAL_HEADER['image/jpeg']}` })
    expect(res.status).toBe(400)
    expect(updateUserAvatar).not.toHaveBeenCalled()
  })

  it('rejects a decoded image over the size cap', async () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(7_100_000)
    const res = await avatar({ avatar: big })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('too large')
    expect(updateUserAvatar).not.toHaveBeenCalled()
  })

  it('rate-limits the eleventh upload in the minute', async () => {
    for (let i = 0; i < 10; i++) expect((await avatar({ avatar: PNG })).status).toBe(200)
    expect((await avatar({ avatar: PNG })).status).toBe(429)
  })
})

describe('POST /api/auth/exchange-mobile-token', () => {
  const entry = { challenge: 'chal', sessionCookieValue: 'a.session.jwt' }

  it('requires both a token and a verifier', async () => {
    for (const body of [{}, { token: 't' }, { verifier: 'v' }, { token: 1, verifier: 'v' }]) {
      const res = await exchange(body, freshIp())
      expect(res.status).toBe(400)
    }
    expect(consumeMobileAuthToken).not.toHaveBeenCalled()
  })

  it('refuses an oversized body', async () => {
    expect((await exchange({ token: 'x'.repeat(16 * 1024), verifier: 'v' }, freshIp())).status).toBe(413)
  })

  it('401s an unknown token', async () => {
    consumeMobileAuthToken.mockReturnValue(null)
    const res = await exchange({ token: 'nope', verifier: 'v' }, freshIp())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid or expired token' })
  })
  it('burns the token even when the verifier fails', async () => {
    consumeMobileAuthToken.mockReturnValue(entry)
    verifyPkce.mockReturnValue(false)
    expect((await exchange({ token: 'tok', verifier: 'wrong' }, freshIp())).status).toBe(401)
    expect(consumeMobileAuthToken).toHaveBeenCalledWith('tok')
    consumeMobileAuthToken.mockReturnValue(null)
    verifyPkce.mockReturnValue(true)
    expect((await exchange({ token: 'tok', verifier: 'right' }, freshIp())).status).toBe(401)
  })

  it('checks the account again before issuing either response type', async () => {
    getUserById.mockResolvedValue({ isActive: false, isAdmin: false })
    consumeMobileAuthToken.mockReturnValue(entry)
    for (const responseType of ['cookie', 'token']) {
      expect((await exchange({ token: 'tok', verifier: 'right', responseType }, freshIp())).status).toBe(401)
    }
  })

  it('refuses expired or invalid sessions before setting a cookie', async () => {
    consumeMobileAuthToken.mockReturnValue(entry)
    sessionTokenFrom.mockResolvedValue(null)
    expect((await exchange({ token: 'tok', verifier: 'right' }, freshIp())).status).toBe(401)
    sessionTokenFrom.mockResolvedValue({ userId: 'u-1', exp: 1 })
    expect((await exchange({ token: 'tok', verifier: 'right' }, freshIp())).status).toBe(401)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it('sets an httpOnly session cookie and never puts it in the body', async () => {
    consumeMobileAuthToken.mockReturnValue(entry)
    const res = await exchange({ token: 'tok', verifier: 'right' }, freshIp())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('a.session.jwt')
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=lax/i)
    expect(cookie).toContain('Max-Age=3600')
    expect(verifyPkce).toHaveBeenCalledWith('right', 'chal')
  })

  it('rate-limits by IP, so one attacker cannot grind tokens', async () => {
    const ip = freshIp()
    consumeMobileAuthToken.mockReturnValue(null)
    for (let i = 0; i < 10; i++) expect((await exchange({ token: `t${i}`, verifier: 'v' }, ip)).status).toBe(401)
    expect((await exchange({ token: 't10', verifier: 'v' }, ip)).status).toBe(429)
    expect((await exchange({ token: 't11', verifier: 'v' }, freshIp())).status).toBe(401)
  })
})
