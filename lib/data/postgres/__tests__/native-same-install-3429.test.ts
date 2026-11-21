// #3429 item 2: an install that signs in again ends its older sign-in. Against a real Postgres, with
// a second account holding the same install id: what is revoked is read back from the table.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { randomBytes } from 'crypto'
import { hashRefreshToken, type RefreshTokenHash } from '@/lib/auth/refresh-token-hash'

const canRun = !!process.env.DATABASE_URL
const USER_A = '00000000-0000-4000-8000-0000034290a1'
const USER_B = '00000000-0000-4000-8000-0000034290b1'
const INSTALL = 'install-3429-same'

const newHash = (): RefreshTokenHash => hashRefreshToken(randomBytes(32).toString('base64url'))!
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000)

describe.skipIf(!canRun)('a new native sign-in from the same install revokes the older one (#3429)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const create = (userId: string, deviceId?: string | null) =>
    repo.createNativeRefreshToken({ userId, tokenHash: newHash(), deviceLabel: 'Phone', deviceId, expiresAt: inDays(30) })
  const rowsOf = async (familyId: string) =>
    (await pool.query<{ revoked_reason: string | null }>(
      `SELECT revoked_reason FROM native_refresh_tokens WHERE family_id = $1 ORDER BY created_at`, [familyId])).rows

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[USER_A, USER_B]])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_active) VALUES
         ($1, 'same-install-a-3429@example.com', 'x', 'Australia/Brisbane', true),
         ($2, 'same-install-b-3429@example.com', 'x', 'Australia/Brisbane', true)`, [USER_A, USER_B])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM native_refresh_tokens WHERE user_id = ANY($1::uuid[])`, [[USER_A, USER_B]])
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[USER_A, USER_B]])
  })

  it('revokes the install\'s older family, rotated rows included, and lists one device', async () => {
    const first = await create(USER_A, INSTALL)
    const rotated = await repo.rotateNativeRefreshToken({ userId: USER_A, id: first.id, newTokenHash: newHash(), expiresAt: inDays(30) })
    expect(rotated).not.toBeNull()
    const second = await create(USER_A, INSTALL)

    expect(await rowsOf(first.familyId)).toEqual([{ revoked_reason: 'sign_out' }, { revoked_reason: 'sign_out' }])
    expect(await rowsOf(second.familyId)).toEqual([{ revoked_reason: null }])
    expect((await repo.listNativeDevices(USER_A)).map(d => d.familyId)).toEqual([second.familyId])
    // The old family's live token can no longer rotate.
    expect(await repo.rotateNativeRefreshToken({ userId: USER_A, id: rotated!.id, newTokenHash: newHash(), expiresAt: inDays(30) })).toBeNull()
  })

  it('leaves a second account with the same install id alone', async () => {
    const other = await create(USER_B, INSTALL)
    await create(USER_A, INSTALL)
    expect(await rowsOf(other.familyId)).toEqual([{ revoked_reason: null }])
  })

  it('leaves the account\'s other installs alone', async () => {
    const elsewhere = await create(USER_A, 'install-3429-other')
    await create(USER_A, INSTALL)
    expect(await rowsOf(elsewhere.familyId)).toEqual([{ revoked_reason: null }])
  })

  it('a sign-in that names no install revokes nothing', async () => {
    const named = await create(USER_A, INSTALL)
    const unnamedA = await create(USER_A, null)
    await create(USER_A, undefined)
    expect(await rowsOf(named.familyId)).toEqual([{ revoked_reason: null }])
    expect(await rowsOf(unnamedA.familyId)).toEqual([{ revoked_reason: null }])
  })

  it('keeps the first reason on a family that was already revoked', async () => {
    const first = await create(USER_A, INSTALL)
    await repo.revokeNativeRefreshTokenFamily(USER_A, first.familyId, 'user')
    await create(USER_A, INSTALL)
    expect(await rowsOf(first.familyId)).toEqual([{ revoked_reason: 'user' }])
  })

  it('through issueNativeSession, the route\'s entry point, too', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-secret-3429-'.padEnd(40, 'x'))
    const { issueNativeSession } = await import('@/lib/auth/mobile/session')
    const user = (await repo.getUserById(USER_A))!
    await issueNativeSession(user, { label: 'Phone', id: INSTALL })
    await issueNativeSession(user, { label: 'Phone', id: INSTALL })
    const { rows } = await pool.query<{ live: number; total: number }>(
      `SELECT count(*) FILTER (WHERE revoked_at IS NULL)::int AS live, count(*)::int AS total
         FROM native_refresh_tokens WHERE user_id = $1`, [USER_A])
    expect(rows[0]).toEqual({ live: 1, total: 2 })
  })

  // #3949 review N5: two sign-ins from one install at the same moment. An older family is held
  // locked by a second connection, so both sign-ins are parked mid-way: without the per-install lock
  // both had already searched (finding only the older family) and both survived. With it, the second
  // waits before its search, then finds the first's family and revokes it.
  it('two concurrent sign-ins from one install leave exactly one live', async () => {
    const older = await create(USER_A, INSTALL)
    const holder = await pool.connect()
    await holder.query('BEGIN')
    await holder.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [older.familyId])
    const parked = async () => Number((await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND wait_event = 'advisory' AND query LIKE '%pg_advisory_xact_lock%'
          AND pid <> pg_backend_pid()`)).rows[0].n)
    const both = Promise.all([create(USER_A, INSTALL), create(USER_A, INSTALL)])
    for (let i = 0; i < 300 && await parked() < 2; i++) await new Promise(r => setTimeout(r, 10))
    await holder.query('COMMIT')
    holder.release()
    await both
    const { rows } = await pool.query<{ live: number; total: number }>(
      `SELECT count(*) FILTER (WHERE revoked_at IS NULL)::int AS live, count(*)::int AS total
         FROM native_refresh_tokens WHERE user_id = $1 AND device_id = $2`, [USER_A, INSTALL])
    expect(rows[0]).toEqual({ live: 1, total: 3 })
  })
})
