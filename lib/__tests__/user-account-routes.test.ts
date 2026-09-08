/**
 * PS-39 — the account cluster: `user/password`, `user/profile`, `user/preferences`, `user/avatar`
 * and `auth/exchange-mobile-token`.
 *
 * Batched because they are the write paths onto a user's own credentials and identity, and they
 * verify as a set — the password change reads the hash that `user/profile` must never return, and
 * the token exchange is what mints the session all four of the others authenticate with.
 *
 * Each carries a decision that is invisible from the response shape and has a note in the source
 * saying why:
 *
 *   · **A captured mobile token burns on the attacker's first attempt.** The one-time token is
 *     consumed BEFORE the PKCE verifier is checked, so a failed exchange leaves nothing redeemable.
 *   · **`user/profile` strips the password hash and reports only whether one exists.** The
 *     repository hands the route the whole row, hash included.
 *   · **Omitted and explicitly-null are different** on both PATCH routes (BF-78). Collapsing them
 *     meant no profile field could ever be cleared.
 *   · **The avatar MIME whitelist is a whitelist, not a prefix.** The old `data:image/` check
 *     accepted `svg+xml` — a script-bearing format stored and re-served as a user's avatar.
 *   · **A malformed body on a credential route is a 400, not a 500.** Bare `req.json()` threw, and
 *     Next answered 500 on a password change.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const getUserByEmail = vi.fn(async (_e: string) => userRow() as Row | null)
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
  // Built inside the returned function: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({
    getUserByEmail, updateUserPassword, updateUserProfile, updateUserAvatar,
    countWorkoutSessions, getUserPreferences, updateUserPreferences,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('bcryptjs', () => ({
  default: {
    compare: (p: string, h: string) => bcryptCompare(p, h),
    hash: (p: string, r: number) => bcryptHash(p, r),
  },
}))
vi.mock('@/lib/mobile-auth-tokens', () => ({ consumeMobileAuthToken: (t: string) => consumeMobileAuthToken(t) }))
vi.mock('@/lib/pkce', () => ({ verifyPkce: (v: string, c: string) => verifyPkce(v, c) }))

import { PATCH as changePassword } from '@/app/api/user/password/route'
import { GET as readProfile, PATCH as patchProfile } from '@/app/api/user/profile/route'
import { GET as readPreferences, PATCH as patchPreferences } from '@/app/api/user/preferences/route'
import { POST as uploadAvatar } from '@/app/api/user/avatar/route'
import { POST as exchangeToken } from '@/app/api/auth/exchange-mobile-token/route'

/** The row the repository hands back — hash included, which is the point. */
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
}), { nextUrl: new URL(`http://localhost${url}`) }) as never)

const password = (body: unknown) => send(changePassword as never, '/api/user/password', 'PATCH', body)
const profilePatch = (body: unknown) => send(patchProfile as never, '/api/user/profile', 'PATCH', body)
const prefsPatch = (body: unknown) => send(patchPreferences as never, '/api/user/preferences', 'PATCH', body)
const avatar = (body: unknown) => send(uploadAvatar as never, '/api/user/avatar', 'POST', body)
const exchange = (body: unknown, headers: Record<string, string> = {}) =>
  send(exchangeToken as never, '/api/auth/exchange-mobile-token', 'POST', body, headers)

let seq = 0
/** Every case gets its own user id. The password and avatar routes are rate-limited per user, and
 *  `beforeEach` resets mocks but NOT the limiter — cases sharing one id spend each other's budget
 *  and start answering 429 for reasons that have nothing to do with what they assert. */
const freshUser = () => { sessionUser = { id: `u-${++seq}`, email: `u${seq}@example.com` } }
const me = () => sessionUser!.id
/** The exchange route rate-limits by IP, so each case needs its own. */
let ipSeq = 0
const freshIp = () => ({ 'x-forwarded-for': `10.0.0.${++ipSeq}` })

beforeEach(() => {
  vi.clearAllMocks()
  freshUser()
  getUserByEmail.mockResolvedValue(userRow())
  updateUserProfile.mockResolvedValue({ id: 'u-1', displayName: 'Sam' })
  updateUserAvatar.mockResolvedValue({ avatar: 'stored.png' })
  countWorkoutSessions.mockResolvedValue(42)
  getUserPreferences.mockResolvedValue({ scoreRingStyle: 'solid' })
  updateUserPreferences.mockResolvedValue({ scoreRingStyle: 'solid' })
  // `clearAllMocks` clears calls, not implementations — a rejection from one case would leak.
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

  // Bare `req.json()` threw here, and Next answered 500 — on a credential route.
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
    expect(getUserByEmail).not.toHaveBeenCalled()
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

  // An OAuth-only account has no hash to verify against; requiring one would lock it out of ever
  // setting a password.
  it('lets an account with no password set one without a current password', async () => {
    getUserByEmail.mockResolvedValue(userRow({ passwordHash: null }))
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

  // The repository hands over the whole row. Only `hasPassword` may survive of it.
  it('never returns the password hash, only whether one exists', async () => {
    const body = await (await readProfile()).json()
    expect(body.hasPassword).toBe(true)
    expect(body.user).not.toHaveProperty('passwordHash')
    expect(JSON.stringify(body)).not.toContain('$2b$12$')

    getUserByEmail.mockResolvedValue(userRow({ passwordHash: null }))
    expect((await (await readProfile()).json()).hasPassword).toBe(false)
  })

  it('404s when the session names a user the repository cannot find', async () => {
    getUserByEmail.mockResolvedValue(null)
    expect((await readProfile()).status).toBe(404)
  })

  it('rejects an unknown key and an out-of-range value', async () => {
    // Each against a body that would otherwise succeed, so the schema is what refuses it.
    expect((await profilePatch({ displayName: 'Sam', isAdmin: true })).status).toBe(400)
    expect((await profilePatch({ heightCm: 1000 })).status).toBe(400)
    expect((await profilePatch({ dateOfBirth: '15/06/1993' })).status).toBe(400)
    expect((await profilePatch({ sex: 'unspecified' })).status).toBe(400)
    expect(updateUserProfile).not.toHaveBeenCalled()
  })

  // BF-78. Collapsing the two meant no field could ever be cleared.
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

  // `null` clears a key, absence leaves it alone — that distinction is what this pins. The route's
  // `value !== undefined` filter beside it is NOT covered and cannot be: JSON has no `undefined`, so
  // no HTTP body can produce a parsed key holding one. Mutating that filter away fails nothing,
  // which is the honest reading of a guard that is unreachable from the wire rather than a gap here.
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
  const PNG = 'data:image/png;base64,' + 'A'.repeat(100)

  it('refuses without a session', async () => {
    sessionUser = null
    expect((await avatar({ avatar: PNG })).status).toBe(401)
  })

  it('requires an avatar string', async () => {
    expect((await avatar({})).status).toBe(400)
    expect((await avatar({ avatar: 42 })).status).toBe(400)
    expect(updateUserAvatar).not.toHaveBeenCalled()
  })

  // The old check was a `data:image/` PREFIX, which accepts svg+xml — a script-bearing format
  // stored and re-served as a user's avatar.
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

  it('accepts the three whitelisted types', async () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
      expect((await avatar({ avatar: `data:${mime};base64,AAAA` })).status).toBe(200)
    }
    expect(updateUserAvatar).toHaveBeenCalledTimes(3)
  })

  it('rejects a decoded image over the size cap', async () => {
    // The two limits are 260 KB apart and the case has to land between them: base64 is 4/3 of the
    // payload, so the 5 MiB decoded cap is 6,990,507 characters and the 7 MiB stream guard is
    // 7,340,032 bytes of whole body. 7.1 M characters clears the first and stays under the second,
    // so this lands on the decoded-size check rather than the transport one.
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

  // The one-time token is consumed BEFORE the verifier is checked, deliberately: a captured token
  // burns on the attacker's first attempt rather than staying redeemable for the real client.
  //
  // The ordering is structural rather than a choice a mutation can undo — the challenge to verify
  // AGAINST only exists inside the consumed entry, so there is no verify-then-consume to write. What
  // this pins is the consequence: the failed attempt consumed it, and the retry finds nothing.
  it('burns the token even when the verifier fails', async () => {
    consumeMobileAuthToken.mockReturnValue(entry)
    verifyPkce.mockReturnValue(false)
    expect((await exchange({ token: 'tok', verifier: 'wrong' }, freshIp())).status).toBe(401)
    expect(consumeMobileAuthToken).toHaveBeenCalledWith('tok')

    // The real client retrying with the right verifier now finds nothing to redeem.
    consumeMobileAuthToken.mockReturnValue(null)
    verifyPkce.mockReturnValue(true)
    expect((await exchange({ token: 'tok', verifier: 'right' }, freshIp())).status).toBe(401)
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
    expect(cookie).toContain('Max-Age=2592000')  // 30 days
    expect(verifyPkce).toHaveBeenCalledWith('right', 'chal')
  })

  it('rate-limits by IP, so one attacker cannot grind tokens', async () => {
    const ip = freshIp()
    consumeMobileAuthToken.mockReturnValue(null)
    for (let i = 0; i < 10; i++) expect((await exchange({ token: `t${i}`, verifier: 'v' }, ip)).status).toBe(401)
    expect((await exchange({ token: 't10', verifier: 'v' }, ip)).status).toBe(429)
    // A different address is unaffected — the limit is per-IP, not global.
    expect((await exchange({ token: 't11', verifier: 'v' }, freshIp())).status).toBe(401)
  })
})
