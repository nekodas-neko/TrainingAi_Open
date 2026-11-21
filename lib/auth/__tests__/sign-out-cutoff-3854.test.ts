import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { randomBytes } from 'crypto'

// #3854 item 1: a web sign-out moves the account's sign-in cut-off to now, so a session cookie set
// again after the sign-out (a late beacon response, an <img> load, the service worker) is refused.
// Real rows: only the session (`auth`) and Auth.js's own cookie clear (`signOut`) are supplied. The
// refusal is read through the real `refreshIsActiveClaim` against the row the sign-out wrote, the
// test every `auth()` call runs; a second account is checked to be untouched.
const USER_A = '00000000-0000-4000-8000-0000038540a1'
const USER_B = '00000000-0000-4000-8000-0000038540b1'

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  authSignOut: vi.fn(async (_opts: unknown) => undefined),
  authThrows: false,
}))
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => { if (mocks.authThrows) throw new Error('no request'); return mocks.session }),
  signOut: mocks.authSignOut,
}))

const canRun = !!process.env.DATABASE_URL
const nowS = () => Math.floor(Date.now() / 1000)

describe.skipIf(!canRun)('web sign-out sets the server-side sign-in cut-off (#3854 item 1)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const cutoffOf = async (id: string) =>
    (await pool.query<{ at: Date | null }>('SELECT sign_ins_valid_from AS at FROM users WHERE id = $1', [id])).rows[0]?.at ?? null
  /** What `auth()` decides for a cookie of `userId` signed in at `signedInAt`, from the stored row. */
  const accepted = async (userId: string, signedInAt: number) => {
    const { refreshIsActiveClaim } = await import('@/lib/auth/is-active-refresh')
    const claims = await refreshIsActiveClaim<{ userId: string; signedInAt: number; isActive?: boolean }>({ userId, signedInAt }, id => repo.getUserById(id))
    return claims.isActive === true
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[USER_A, USER_B]])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_active) VALUES
         ($1, 'sign-out-a-3854@example.com', 'x', 'Australia/Brisbane', true),
         ($2, 'sign-out-b-3854@example.com', 'x', 'Australia/Brisbane', true)`, [USER_A, USER_B])
  })

  beforeEach(async () => {
    await pool.query('UPDATE users SET sign_ins_valid_from = NULL WHERE id = ANY($1::uuid[])', [[USER_A, USER_B]])
    await pool.query('DELETE FROM native_refresh_tokens WHERE user_id = ANY($1::uuid[])', [[USER_A, USER_B]])
    mocks.session = { user: { id: USER_A } }
    mocks.authThrows = false
    mocks.authSignOut.mockClear()
  })

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[USER_A, USER_B]])
  })

  it('refuses the signed-out session, keeps a sign-in after it, and leaves another account alone', async () => {
    const signedInEarlier = nowS() - 3600
    expect(await accepted(USER_A, signedInEarlier)).toBe(true)
    const { signOut } = await import('@/app/actions')
    await signOut()

    expect(mocks.authSignOut).toHaveBeenCalledWith({ redirectTo: '/sign-in' })
    const cutoff = await cutoffOf(USER_A)
    expect(cutoff).not.toBeNull()
    expect(Math.abs(cutoff!.getTime() - Date.now())).toBeLessThan(10_000)
    // The old cookie, set again by any late response, is refused; a sign-in from now on is not.
    expect(await accepted(USER_A, signedInEarlier)).toBe(false)
    expect(await accepted(USER_A, await repo.signInStampFor(USER_A))).toBe(true)
    // The other account: no cut-off, and its sessions still pass.
    expect(await cutoffOf(USER_B)).toBeNull()
    expect(await accepted(USER_B, signedInEarlier)).toBe(true)
  })

  it('"Use another account" (signOutInPlace) sets it the same way', async () => {
    const { signOutInPlace } = await import('@/app/actions')
    await signOutInPlace()
    expect(mocks.authSignOut).toHaveBeenCalledWith({ redirectTo: '/mobile-signin/native' })
    expect(await cutoffOf(USER_A)).not.toBeNull()
    expect(await accepted(USER_A, nowS() - 60)).toBe(false)
  })

  it('also ends a native sign-in made before it (the column is per account)', async () => {
    const { hashRefreshToken } = await import('@/lib/auth/refresh-token-hash')
    const raw = randomBytes(32).toString('base64url')
    const row = await repo.createNativeRefreshToken({
      userId: USER_A, tokenHash: hashRefreshToken(raw)!, deviceLabel: 'Phone', expiresAt: new Date(Date.now() + 86_400_000),
    })
    // Issued a minute ago, so it is plainly before the cut-off rather than in the same second.
    await pool.query(`UPDATE native_refresh_tokens SET created_at = now() - interval '1 minute' WHERE id = $1`, [row.id])
    const { signOut } = await import('@/app/actions')
    await signOut()
    vi.stubEnv('AUTH_SECRET', 'test-secret-3854-'.padEnd(40, 'x'))
    const { rotateNativeSession } = await import('@/lib/auth/mobile/session')
    expect(await rotateNativeSession(raw)).toEqual({ ok: false, reason: 'invalid' })
    vi.unstubAllEnvs()
  })

  it('the cut-off only moves forward: a second sign-out never moves it back, and moves past the first', async () => {
    const later = new Date(Math.floor(Date.now() / 1000) * 1000 + 60_000)
    await pool.query('UPDATE users SET sign_ins_valid_from = $2 WHERE id = $1', [USER_A, later])
    const { signOut } = await import('@/app/actions')
    await signOut()
    expect((await cutoffOf(USER_A))!.getTime()).toBe(later.getTime() + 1000)
  })

  // #3949 review N1: the cut-off and every stamp come from the database clock, and the rule is
  // strict. A sign-in stamped just before the sign-out (in practice the same second) is refused;
  // one stamped after it, however soon, is kept. Web and native alike.
  it('has no same-second survivor, and a sign-in right after it is kept', async () => {
    const { hashRefreshToken } = await import('@/lib/auth/refresh-token-hash')
    const raw = randomBytes(32).toString('base64url')
    await repo.createNativeRefreshToken({
      userId: USER_A, tokenHash: hashRefreshToken(raw)!, deviceLabel: 'Phone', expiresAt: new Date(Date.now() + 86_400_000),
    })
    const webBefore = await repo.signInStampFor(USER_A)
    const { signOut } = await import('@/app/actions')
    await signOut()
    const cutoff = (await cutoffOf(USER_A))!
    expect(cutoff.getTime() % 1000).toBe(0)
    expect(cutoff.getTime() / 1000).toBeGreaterThan(webBefore)
    expect(await accepted(USER_A, webBefore)).toBe(false)
    expect(await accepted(USER_A, await repo.signInStampFor(USER_A))).toBe(true)

    vi.stubEnv('AUTH_SECRET', 'test-secret-3854-'.padEnd(40, 'x'))
    const { rotateNativeSession } = await import('@/lib/auth/mobile/session')
    expect(await rotateNativeSession(raw)).toEqual({ ok: false, reason: 'invalid' })
    const raw2 = randomBytes(32).toString('base64url')
    const after = await repo.createNativeRefreshToken({
      userId: USER_A, tokenHash: hashRefreshToken(raw2)!, deviceLabel: 'Phone', expiresAt: new Date(Date.now() + 86_400_000),
    })
    expect(after.createdAt.getTime()).toBeGreaterThanOrEqual(cutoff.getTime())
    expect((await rotateNativeSession(raw2)).ok).toBe(true)
    vi.unstubAllEnvs()
  })

  // #3949 review S3: a native refresh in flight and a web sign-out, interleaved for real. A second
  // connection holds the family's lock so each side can be parked at the point it takes it.
  describe('a native refresh in flight is serialised with the sign-out', () => {
    const SECRET_3854 = 'test-secret-3854-'.padEnd(40, 'x')
    // Requests queued on this family's lock only (a one-key advisory lock: objsubid 1, objid its low
    // 32 bits), so other test files' locks cannot satisfy the wait.
    const waiting = async (familyId: string) => Number((await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
         AND objid::text::bigint = (hashtext($1::text)::bigint & 4294967295)`, [familyId])).rows[0].n)
    const until = async (familyId: string, n: number) => {
      for (let i = 0; i < 300 && await waiting(familyId) < n; i++) await new Promise(r => setTimeout(r, 10))
      expect(await waiting(familyId)).toBe(n)
    }
    const seed = async () => {
      const { hashRefreshToken } = await import('@/lib/auth/refresh-token-hash')
      const raw = randomBytes(32).toString('base64url')
      const row = await repo.createNativeRefreshToken({
        userId: USER_A, tokenHash: hashRefreshToken(raw)!, deviceLabel: 'Phone', expiresAt: new Date(Date.now() + 86_400_000),
      })
      return { raw, row }
    }
    const holdFamily = async (familyId: string) => {
      const client = await pool.connect()
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [familyId])
      return async () => { await client.query('COMMIT'); client.release() }
    }

    it('a rotation that holds the lock first commits first, and the sign-out then ends what it issued', async () => {
      vi.stubEnv('AUTH_SECRET', SECRET_3854)
      const { raw, row } = await seed()
      const release = await holdFamily(row.familyId)
      const { rotateNativeSession } = await import('@/lib/auth/mobile/session')
      const rotation = rotateNativeSession(raw)
      await until(row.familyId, 1)
      const { signOut } = await import('@/app/actions')
      const signedOut = signOut()
      await until(row.familyId, 2)
      // The sign-out is parked behind the rotation: nothing is written while the rotation is in flight.
      expect(await cutoffOf(USER_A)).toBeNull()
      await release()
      const rotated = await rotation
      await signedOut
      expect(rotated.ok).toBe(true)
      if (!rotated.ok) return
      // What the rotation issued is below the cut-off: its access token is refused, and its refresh
      // token does not rotate again.
      const { sessionTokenFrom } = await import('@/lib/auth/session-token')
      const access = await sessionTokenFrom(new Headers({ authorization: `Bearer ${rotated.body.accessToken}` }))
      expect(await accepted(USER_A, access!.signedInAt as number)).toBe(false)
      expect(await rotateNativeSession(rotated.body.refreshToken)).toEqual({ ok: false, reason: 'invalid' })
      vi.unstubAllEnvs()
    })

    it('a rotation that reads the account before the sign-out commits, but locks after it, is refused and writes nothing', async () => {
      vi.stubEnv('AUTH_SECRET', SECRET_3854)
      const { raw, row } = await seed()
      const release = await holdFamily(row.familyId)
      const { signOut } = await import('@/app/actions')
      const signedOut = signOut()
      await until(row.familyId, 1)
      const { rotateNativeSession } = await import('@/lib/auth/mobile/session')
      // Its early check reads the account now, before the cut-off exists, and passes; it then
      // queues for the family lock behind the sign-out.
      const rotation = rotateNativeSession(raw)
      await until(row.familyId, 2)
      await release()
      await signedOut
      expect(await rotation).toEqual({ ok: false, reason: 'invalid' })
      const rows = (await pool.query<{ n: string }>(
        'SELECT count(*) AS n FROM native_refresh_tokens WHERE family_id = $1', [row.familyId])).rows[0]
      expect(Number(rows.n)).toBe(1)
      const stored = (await pool.query<{ rotated_at: Date | null; revoked_reason: string | null }>(
        'SELECT rotated_at, revoked_reason FROM native_refresh_tokens WHERE id = $1', [row.id])).rows[0]
      expect(stored).toEqual({ rotated_at: null, revoked_reason: null })
      vi.unstubAllEnvs()
    })

    it('the lost-response regrant, interleaved the same way, is refused too and writes nothing', async () => {
      vi.stubEnv('AUTH_SECRET', SECRET_3854)
      const { raw, row } = await seed()
      const { rotateNativeSession } = await import('@/lib/auth/mobile/session')
      expect((await rotateNativeSession(raw)).ok).toBe(true)
      const before = Number((await pool.query<{ n: string }>(
        'SELECT count(*) AS n FROM native_refresh_tokens WHERE family_id = $1', [row.familyId])).rows[0].n)
      const release = await holdFamily(row.familyId)
      const { signOut } = await import('@/app/actions')
      const signedOut = signOut()
      await until(row.familyId, 1)
      // The same (now rotated) token again within the grace: the regrant path.
      const regrant = rotateNativeSession(raw)
      await until(row.familyId, 2)
      await release()
      await signedOut
      expect(await regrant).toEqual({ ok: false, reason: 'invalid' })
      const after = await pool.query<{ revoked_reason: string | null }>(
        'SELECT revoked_reason FROM native_refresh_tokens WHERE family_id = $1', [row.familyId])
      expect(after.rows.length).toBe(before)
      expect(after.rows.every(r => r.revoked_reason === null)).toBe(true)
      vi.unstubAllEnvs()
    })
  })

  it('records nothing without a session, and the cookie clear still runs', async () => {
    mocks.session = null
    const { signOut } = await import('@/app/actions')
    await signOut()
    expect(mocks.authSignOut).toHaveBeenCalledTimes(1)
    expect(await cutoffOf(USER_A)).toBeNull()
    expect(await cutoffOf(USER_B)).toBeNull()
  })

  it('a session whose account is gone records nothing and still clears the cookie', async () => {
    mocks.session = { user: { id: '00000000-0000-4000-8000-0000038540ff' } }
    const { signOut } = await import('@/app/actions')
    await expect(signOut()).resolves.toBeUndefined()
    expect(mocks.authSignOut).toHaveBeenCalledTimes(1)
  })

  it('a session lookup that throws still clears the cookie', async () => {
    mocks.authThrows = true
    const { signOut } = await import('@/app/actions')
    await signOut()
    expect(mocks.authSignOut).toHaveBeenCalledTimes(1)
    expect(await cutoffOf(USER_A)).toBeNull()
  })
})
