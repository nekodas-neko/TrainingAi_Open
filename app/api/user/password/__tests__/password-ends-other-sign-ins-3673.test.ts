import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { randomBytes } from 'crypto'
import { NextRequest } from 'next/server'
import { decode, encode } from 'next-auth/jwt'

// #3673 item 5: changing the password ends every other sign-in of the account. Real rows for two
// accounts; only the session (`auth`) is supplied. Read back: the password, the account's sign-in
// cut-off, every native sign-in row, and the cookie this browser gets, judged by the real
// `refreshIsActiveClaim` the way every `auth()` call judges it.
const USER_A = '00000000-0000-4000-8000-0000036730a1'
const USER_B = '00000000-0000-4000-8000-0000036730b1'
const OLD = 'old-password-3673'
const NEW = 'new-password-3673'
const SECRET = 'test-secret-3673-'.padEnd(40, 'x')
const COOKIE = 'authjs.session-token'

const mocks = vi.hoisted(() => ({ session: null as null | Record<string, unknown> }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => mocks.session) }))

const canRun = !!process.env.DATABASE_URL
const nowS = () => Math.floor(Date.now() / 1000)

describe.skipIf(!canRun)('PATCH /api/user/password ends other sign-ins (#3673 item 5)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let oldHash: string
  const signedInEarlier = nowS() - 3600

  const accepted = async (userId: string, signedInAt: number) => {
    const { refreshIsActiveClaim } = await import('@/lib/auth/is-active-refresh')
    return (await refreshIsActiveClaim({ userId, signedInAt }, id => repo.getUserById(id))).isActive === true
  }
  const nativeRows = async (userId: string) =>
    (await pool.query<{ revoked_reason: string | null }>(
      'SELECT revoked_reason FROM native_refresh_tokens WHERE user_id = $1 ORDER BY created_at', [userId])).rows
  const seedNative = async (userId: string) => {
    const { hashRefreshToken } = await import('@/lib/auth/refresh-token-hash')
    await repo.createNativeRefreshToken({
      userId, tokenHash: hashRefreshToken(randomBytes(32).toString('base64url'))!, deviceLabel: 'Phone',
      expiresAt: new Date(Date.now() + 86_400_000),
    })
  }
  const cookieFor = (userId: string) =>
    encode({ secret: SECRET, salt: COOKIE, token: { userId, sub: userId, isActive: true, signedInAt: signedInEarlier } })
  const patch = async (body: unknown, cookie?: string, headers: Record<string, string> = {}) => {
    const { PATCH } = await import('@/app/api/user/password/route')
    return PATCH(new NextRequest('http://localhost/api/user/password', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}), ...headers },
      body: JSON.stringify(body),
    }))
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    const { hashPassword } = await import('@/lib/auth/password')
    pool = getPool()
    repo = await getRepository()
    oldHash = await hashPassword(OLD)
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[USER_A, USER_B]])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_active) VALUES
         ($1, 'pw-change-a-3673@example.com', $3, 'Australia/Brisbane', true),
         ($2, 'pw-change-b-3673@example.com', $3, 'Australia/Brisbane', true)`, [USER_A, USER_B, oldHash])
  })

  beforeEach(async () => {
    vi.stubEnv('AUTH_SECRET', SECRET)
    await pool.query('UPDATE users SET password_hash = $2, sign_ins_valid_from = NULL WHERE id = ANY($1::uuid[])', [[USER_A, USER_B], oldHash])
    await pool.query('DELETE FROM native_refresh_tokens WHERE user_id = ANY($1::uuid[])', [[USER_A, USER_B]])
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE 'pw-change:00000000-0000-4000-8000-0000036730%'`)
    mocks.session = { user: { id: USER_A }, signedInAt: signedInEarlier }
    await seedNative(USER_A)
    await seedNative(USER_A)
    await seedNative(USER_B)
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[USER_A, USER_B]])
  })

  it('ends every other sign-in, keeps this browser signed in, and leaves the other account alone', async () => {
    const res = await patch({ currentPassword: OLD, newPassword: NEW }, await cookieFor(USER_A))
    expect(res.status).toBe(200)

    const { verifyPassword } = await import('@/lib/auth/password')
    const stored = (await pool.query<{ h: string; at: Date | null }>(
      'SELECT password_hash AS h, sign_ins_valid_from AS at FROM users WHERE id = $1', [USER_A])).rows[0]
    expect(await verifyPassword(NEW, stored.h)).toBe(true)
    expect(stored.at).not.toBeNull()

    // Every native sign-in of the account is revoked; the other account's is not.
    expect(await nativeRows(USER_A)).toEqual([{ revoked_reason: 'password_change' }, { revoked_reason: 'password_change' }])
    expect(await nativeRows(USER_B)).toEqual([{ revoked_reason: null }])

    // Any other web session of the account (signed in before the change) is refused.
    expect(await accepted(USER_A, signedInEarlier)).toBe(false)
    expect(await accepted(USER_B, signedInEarlier)).toBe(true)

    // This browser's new cookie is its own session, stamped after the cut-off, and passes.
    const set = res.cookies.get(COOKIE)
    expect(set?.value).toBeTruthy()
    expect(set).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' })
    const token = await decode({ token: set!.value, secret: SECRET, salt: COOKIE })
    expect(token?.userId).toBe(USER_A)
    expect(token!.signedInAt as number).toBeGreaterThanOrEqual(Math.floor(stored.at!.getTime() / 1000))
    expect(await accepted(USER_A, token!.signedInAt as number)).toBe(true)
  })

  it('a wrong current password changes nothing: 400, the old password works, no sign-in ends', async () => {
    const res = await patch({ currentPassword: 'not-the-password', newPassword: NEW }, await cookieFor(USER_A))
    expect(res.status).toBe(400)
    expect(res.cookies.get(COOKIE)).toBeUndefined()
    const { verifyPassword } = await import('@/lib/auth/password')
    const stored = (await pool.query<{ h: string; at: Date | null }>(
      'SELECT password_hash AS h, sign_ins_valid_from AS at FROM users WHERE id = $1', [USER_A])).rows[0]
    expect(await verifyPassword(OLD, stored.h)).toBe(true)
    expect(stored.at).toBeNull()
    expect(await nativeRows(USER_A)).toEqual([{ revoked_reason: null }, { revoked_reason: null }])
    expect(await accepted(USER_A, signedInEarlier)).toBe(true)
  })

  it('no session: 401 and nothing changes', async () => {
    mocks.session = null
    expect((await patch({ currentPassword: OLD, newPassword: NEW })).status).toBe(401)
    expect(await nativeRows(USER_A)).toEqual([{ revoked_reason: null }, { revoked_reason: null }])
  })

  it('a bearer (native) caller gets no cookie: its own sign-in ends with the rest', async () => {
    const res = await patch({ currentPassword: OLD, newPassword: NEW }, undefined, { authorization: 'Bearer native-token' })
    expect(res.status).toBe(200)
    expect(res.cookies.get(COOKIE)).toBeUndefined()
    expect(await nativeRows(USER_A)).toEqual([{ revoked_reason: 'password_change' }, { revoked_reason: 'password_change' }])
    expect(await accepted(USER_A, signedInEarlier)).toBe(false)
  })

  it('the repository write is all or nothing: an account that does not exist throws and ends nothing', async () => {
    await expect(repo.updateUserPassword('00000000-0000-4000-8000-0000036730ff', oldHash)).rejects.toThrow()
    expect(await nativeRows(USER_A)).toEqual([{ revoked_reason: null }, { revoked_reason: null }])
  })
})
