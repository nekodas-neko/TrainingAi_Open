// #3280, end to end against a real Postgres: two devices sign in, the list shows both with their
// labels, revoking one signs that device out (its access token and its refresh token stop working)
// and leaves the other signed in.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000328001'

describe.skipIf(!canRun)('revoking a signed-in device (#3280)', () => {
  let pool: import('pg').Pool
  const raw = (sql: string, params: unknown[] = []) => pool.query(sql, params)

  beforeAll(async () => {
    vi.stubEnv('AUTH_SECRET', 'device-revoke-test-secret-long-enough-for-hs256')
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await raw(`DELETE FROM users WHERE id = $1`, [USER])
    await raw(
      `INSERT INTO users (id, email, password_hash, timezone, is_active) VALUES ($1, 'device-revoke@example.com', 'x', 'Australia/Brisbane', true)`,
      [USER],
    )
  })
  afterAll(async () => {
    if (!canRun) return
    await raw(`DELETE FROM users WHERE id = $1`, [USER])
    vi.unstubAllEnvs()
  })

  it('signs the revoked device out on its next request and refresh, and leaves the other alone', async () => {
    const { getRepositoryAsync } = await import('@/lib/data')
    const { issueNativeSession, rotateNativeSession, presentedNativeFamily } = await import('@/lib/auth/mobile/session')
    const { bearerSession } = await import('@/lib/auth/bearer-session')
    const repo = await getRepositoryAsync()
    const user = (await repo.getUserById(USER))!

    const phone = await issueNativeSession(user, { label: 'Galaxy S25 Ultra', id: 'install-phone-0001' })
    const tablet = await issueNativeSession(user, { label: 'Galaxy Tab S9', id: 'install-tablet-0001' })
    const headers = (s: { accessToken: string }) => new Headers({ authorization: `Bearer ${s.accessToken}` })
    const lookup = async () => user

    const devices = await repo.listNativeDevices(USER)
    expect(devices.map(d => d.deviceLabel).sort()).toEqual(['Galaxy S25 Ultra', 'Galaxy Tab S9'])
    const tabletFamily = (await presentedNativeFamily(headers(tablet), USER))!
    expect(devices.map(d => d.familyId)).toContain(tabletFamily)
    expect(await presentedNativeFamily(headers(phone), USER)).not.toBe(tabletFamily)

    expect((await bearerSession(headers(tablet), lookup))?.user.id).toBe(USER)
    expect(await repo.revokeNativeRefreshTokenFamily(USER, tabletFamily, 'user')).toBeGreaterThan(0)

    expect(await bearerSession(headers(tablet), lookup)).toBeNull()
    expect(await rotateNativeSession(tablet.refreshToken)).toEqual({ ok: false, reason: 'invalid' })
    expect((await bearerSession(headers(phone), lookup))?.user.id).toBe(USER)
    expect((await rotateNativeSession(phone.refreshToken)).ok).toBe(true)

    const after = await repo.listNativeDevices(USER)
    expect(after.map(d => d.deviceLabel)).toEqual(['Galaxy S25 Ultra'])
    const { rows } = await raw(`SELECT DISTINCT revoked_reason FROM native_refresh_tokens WHERE family_id = $1`, [tabletFamily])
    expect(rows).toEqual([{ revoked_reason: 'user' }])
  })
})
