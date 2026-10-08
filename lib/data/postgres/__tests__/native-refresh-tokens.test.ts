// #2076 (PR a). The native refresh-token table (migration 202610071636) and its repository methods,
// against a real Postgres: create and look up by hash, the hash is unique and is never returned,
// rotation keeps the family and links forward, a rotated token cannot rotate again, a family
// revokes together, the CHECKs refuse what the design rules out, every method but the hash lookup
// is scoped to its user, claude_ro withholds the hash, and the rows go with the account.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomBytes, randomUUID } from 'crypto'
import { hashRefreshToken, type RefreshTokenHash } from '@/lib/auth/refresh-token-hash'

const canRun = !!process.env.DATABASE_URL
const USER_A = '00000000-0000-4000-8000-0000000207a1'
const USER_B = '00000000-0000-4000-8000-0000000207b1'
const DOOMED = '00000000-0000-4000-8000-0000000207d1'

const DAY = 86_400_000
const newHash = (): RefreshTokenHash => hashRefreshToken(randomBytes(32).toString('base64url'))!
const inDays = (n: number) => new Date(Date.now() + n * DAY)

describe.skipIf(!canRun)('native_refresh_tokens (#2076)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const raw = (sql: string, params: unknown[] = []) => pool.query(sql, params)
  const create = (userId: string, over: Partial<Parameters<typeof repo.createNativeRefreshToken>[0]> = {}) =>
    repo.createNativeRefreshToken({ userId, tokenHash: newHash(), deviceLabel: 'Galaxy S25 Ultra', expiresAt: inDays(30), ...over })
  /** Make a row look issued two days ago and expired yesterday, within the expiry CHECK. */
  const expire = (id: string) =>
    raw(`UPDATE native_refresh_tokens SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE id = $1`, [id])

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const id of [USER_A, USER_B, DOOMED]) {
      await raw(`DELETE FROM users WHERE id = $1`, [id])
      await raw(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')`,
        [id, `native-refresh-${id.slice(-4)}@example.com`],
      )
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await raw(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[USER_A, USER_B, DOOMED]])
  })

  it('creates a token in a new family and finds it by its hash, without ever returning the hash', async () => {
    const tokenHash = newHash()
    const made = await create(USER_A, { tokenHash, deviceId: 'install-0001' })
    expect(made).toMatchObject({
      userId: USER_A, deviceLabel: 'Galaxy S25 Ultra', deviceId: 'install-0001',
      lastUsedAt: null, rotatedAt: null, replacedBy: null, revokedAt: null, revokedReason: null,
    })
    expect(made.familyId).toMatch(/^[0-9a-f-]{36}$/)
    expect(made.expiresAt.getTime()).toBeGreaterThan(Date.now())

    const found = await repo.findNativeRefreshTokenByHash(tokenHash)
    expect(found).toEqual(made)
    expect(found).not.toHaveProperty('tokenHash')
    expect(JSON.stringify(found)).not.toContain(tokenHash)

    expect(await repo.findNativeRefreshTokenByHash(newHash())).toBeNull()
    // Each sign-in is its own family.
    expect((await create(USER_A)).familyId).not.toBe(made.familyId)
  })

  it('stores the hash exactly as given, and refuses a second row with the same hash', async () => {
    const tokenHash = newHash()
    const made = await create(USER_A, { tokenHash })
    const { rows: [r] } = await raw(`SELECT token_hash FROM native_refresh_tokens WHERE id = $1`, [made.id])
    expect(r.token_hash).toBe(tokenHash)
    await expect(create(USER_B, { tokenHash })).rejects.toThrow()
  })

  it('refuses anything in token_hash that is not a lowercase 64-hex digest', async () => {
    for (const bad of ['a'.repeat(63), 'A'.repeat(64), randomBytes(32).toString('base64url'), 'g'.repeat(64)]) {
      await expect(raw(
        `INSERT INTO native_refresh_tokens (user_id, token_hash, family_id, device_label, expires_at)
         VALUES ($1, $2, gen_random_uuid(), 'x', now() + interval '1 day')`, [USER_A, bad],
      )).rejects.toThrow(/token_hash_check/)
    }
  })

  it('refuses a blank or long device label, a malformed device id, and a lifetime outside (0, 90 days]', async () => {
    await expect(create(USER_A, { deviceLabel: '' })).rejects.toThrow()
    await expect(create(USER_A, { deviceLabel: '   ' })).rejects.toThrow()
    await expect(create(USER_A, { deviceLabel: 'x'.repeat(81) })).rejects.toThrow()
    expect((await create(USER_A, { deviceLabel: 'x'.repeat(80) })).deviceLabel).toHaveLength(80)
    await expect(create(USER_A, { deviceId: 'short' })).rejects.toThrow()
    await expect(create(USER_A, { deviceId: 'has spaces in it' })).rejects.toThrow()
    await expect(create(USER_A, { expiresAt: inDays(-1) })).rejects.toThrow()
    await expect(create(USER_A, { expiresAt: inDays(91) })).rejects.toThrow()
    expect(await create(USER_A, { expiresAt: inDays(89) })).toBeTruthy()
  })

  it('revoked_at and revoked_reason are set together, and only to a known reason', async () => {
    const { id } = await create(USER_A)
    await expect(raw(`UPDATE native_refresh_tokens SET revoked_at = now() WHERE id = $1`, [id])).rejects.toThrow(/revoked_check/)
    await expect(raw(`UPDATE native_refresh_tokens SET revoked_reason = 'user' WHERE id = $1`, [id])).rejects.toThrow(/revoked_check/)
    await expect(raw(`UPDATE native_refresh_tokens SET revoked_at = now(), revoked_reason = 'stolen' WHERE id = $1`, [id]))
      .rejects.toThrow(/revoked_reason_check/)
    await expect(raw(`UPDATE native_refresh_tokens SET replaced_by = $1 WHERE id = $1`, [id])).rejects.toThrow(/replaced_check/)
  })

  it('rotation marks the old token used and rotated, links it to a new one in the same family, and happens once', async () => {
    const first = await create(USER_A, { deviceId: 'install-0002' })
    const nextHash = newHash()
    const second = await repo.rotateNativeRefreshToken({ userId: USER_A, id: first.id, newTokenHash: nextHash, expiresAt: inDays(30) })
    expect(second).toMatchObject({
      userId: USER_A, familyId: first.familyId, deviceLabel: first.deviceLabel, deviceId: 'install-0002',
      rotatedAt: null, replacedBy: null, revokedAt: null,
    })
    expect(second!.id).not.toBe(first.id)
    expect(await repo.findNativeRefreshTokenByHash(nextHash)).toEqual(second)

    const old = await raw(`SELECT rotated_at, last_used_at, replaced_by FROM native_refresh_tokens WHERE id = $1`, [first.id])
    expect(old.rows[0].rotated_at).not.toBeNull()
    expect(old.rows[0].last_used_at).not.toBeNull()
    expect(old.rows[0].replaced_by).toBe(second!.id)

    // The old token again — what PR b reads as reuse. Nothing is written.
    const replay = newHash()
    expect(await repo.rotateNativeRefreshToken({ userId: USER_A, id: first.id, newTokenHash: replay, expiresAt: inDays(30) })).toBeNull()
    expect(await repo.findNativeRefreshTokenByHash(replay)).toBeNull()
    // The rotated row is still found by its hash, so reuse can be told from "unknown".
    const { rows: [h] } = await raw(`SELECT token_hash FROM native_refresh_tokens WHERE id = $1`, [first.id])
    expect((await repo.findNativeRefreshTokenByHash(h.token_hash))?.rotatedAt).not.toBeNull()
  })

  it('two rotations of the same token at once: exactly one wins', async () => {
    const t = await create(USER_A)
    const results = await Promise.all([1, 2, 3].map(() =>
      repo.rotateNativeRefreshToken({ userId: USER_A, id: t.id, newTokenHash: newHash(), expiresAt: inDays(30) })))
    expect(results.filter(Boolean)).toHaveLength(1)
    const { rows: [n] } = await raw(`SELECT count(*)::int AS n FROM native_refresh_tokens WHERE family_id = $1`, [t.familyId])
    expect(n.n).toBe(2)
  })

  it('a revoked or expired token does not rotate', async () => {
    const revoked = await create(USER_A)
    expect(await repo.revokeNativeRefreshToken(USER_A, revoked.id, 'sign_out')).toBe(true)
    expect(await repo.rotateNativeRefreshToken({ userId: USER_A, id: revoked.id, newTokenHash: newHash(), expiresAt: inDays(30) })).toBeNull()

    const expired = await create(USER_A)
    await expire(expired.id)
    expect(await repo.rotateNativeRefreshToken({ userId: USER_A, id: expired.id, newTokenHash: newHash(), expiresAt: inDays(30) })).toBeNull()
  })

  it('revoking one token keeps the first reason; a second revoke is a no-op', async () => {
    const t = await create(USER_A)
    expect(await repo.revokeNativeRefreshToken(USER_A, t.id, 'user')).toBe(true)
    expect(await repo.revokeNativeRefreshToken(USER_A, t.id, 'admin')).toBe(false)
    const found = await raw(`SELECT revoked_reason, revoked_at FROM native_refresh_tokens WHERE id = $1`, [t.id])
    expect(found.rows[0]).toMatchObject({ revoked_reason: 'user' })
    expect(found.rows[0].revoked_at).not.toBeNull()
  })

  it('revoking a family revokes every row in it, rotated ones included, and nothing outside it', async () => {
    const first = await create(USER_A)
    const second = await repo.rotateNativeRefreshToken({ userId: USER_A, id: first.id, newTokenHash: newHash(), expiresAt: inDays(30) })
    const third = await repo.rotateNativeRefreshToken({ userId: USER_A, id: second!.id, newTokenHash: newHash(), expiresAt: inDays(30) })
    const bystander = await create(USER_A)

    expect(await repo.revokeNativeRefreshTokenFamily(USER_A, first.familyId, 'rotation_reuse')).toBe(3)
    const { rows } = await raw(
      `SELECT id, revoked_reason FROM native_refresh_tokens WHERE family_id = $1 ORDER BY created_at, id`, [first.familyId])
    expect(rows.map(r => r.revoked_reason)).toEqual(['rotation_reuse', 'rotation_reuse', 'rotation_reuse'])
    expect(rows.map(r => r.id).sort()).toEqual([first.id, second!.id, third!.id].sort())
    expect((await repo.findNativeRefreshTokenByHash(
      (await raw(`SELECT token_hash FROM native_refresh_tokens WHERE id = $1`, [bystander.id])).rows[0].token_hash,
    ))?.revokedAt).toBeNull()
    // Already revoked: nothing left to change.
    expect(await repo.revokeNativeRefreshTokenFamily(USER_A, first.familyId, 'user')).toBe(0)
  })

  it('lists only live tokens (not rotated, revoked or expired), newest first, with no hash anywhere', async () => {
    await raw(`DELETE FROM native_refresh_tokens WHERE user_id = $1`, [USER_A])
    const older = await create(USER_A, { deviceLabel: 'Tablet' })
    const rotated = await create(USER_A, { deviceLabel: 'Phone' })
    const successor = await repo.rotateNativeRefreshToken({ userId: USER_A, id: rotated.id, newTokenHash: newHash(), expiresAt: inDays(30) })
    const revoked = await create(USER_A, { deviceLabel: 'Old phone' })
    await repo.revokeNativeRefreshToken(USER_A, revoked.id, 'user')
    const expired = await create(USER_A, { deviceLabel: 'Lost phone' })
    await expire(expired.id)

    const live = await repo.listActiveNativeRefreshTokens(USER_A)
    expect(live.map(t => t.id)).toEqual([successor!.id, older.id])
    const { rows } = await raw(`SELECT token_hash FROM native_refresh_tokens WHERE user_id = $1`, [USER_A])
    const text = JSON.stringify(live)
    for (const r of rows) expect(text).not.toContain(r.token_hash)
    for (const t of live) expect(Object.keys(t)).not.toContain('tokenHash')
  })

  it('is scoped to the user: B cannot list, rotate or revoke A\'s tokens or family', async () => {
    const a = await create(USER_A)
    expect((await repo.listActiveNativeRefreshTokens(USER_B)).map(t => t.id)).not.toContain(a.id)
    expect(await repo.rotateNativeRefreshToken({ userId: USER_B, id: a.id, newTokenHash: newHash(), expiresAt: inDays(30) })).toBeNull()
    expect(await repo.revokeNativeRefreshToken(USER_B, a.id, 'user')).toBe(false)
    expect(await repo.revokeNativeRefreshTokenFamily(USER_B, a.familyId, 'user')).toBe(0)
    const { rows: [r] } = await raw(`SELECT rotated_at, revoked_at FROM native_refresh_tokens WHERE id = $1`, [a.id])
    expect(r).toEqual({ rotated_at: null, revoked_at: null })
    expect(await repo.rotateNativeRefreshToken({ userId: USER_A, id: randomUUID(), newTokenHash: newHash(), expiresAt: inDays(30) })).toBeNull()
  })

  it('claude_ro shows the owner\'s rows without the hash', async () => {
    const { rows: cols } = await raw(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'claude_ro' AND table_name = 'native_refresh_tokens'`)
    const names = cols.map(c => c.column_name)
    expect(names).toContain('family_id')
    expect(names).not.toContain('token_hash')

    const mine = await create(USER_A)
    const theirs = await create(USER_B)
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query(`SELECT set_config('app.claude_ro_owner', $1, true)`, [USER_A])
      const { rows } = await c.query(`SELECT id FROM claude_ro.native_refresh_tokens WHERE id = ANY($1::uuid[])`, [[mine.id, theirs.id]])
      expect(rows.map(r => r.id)).toEqual([mine.id])
    } finally {
      await c.query('ROLLBACK')
      c.release()
    }
  })

  it('goes with the account, a rotated chain included', async () => {
    const first = await create(DOOMED)
    await repo.rotateNativeRefreshToken({ userId: DOOMED, id: first.id, newTokenHash: newHash(), expiresAt: inDays(30) })
    const result = await repo.deleteAccount(DOOMED)
    expect(result.deleted).toBe(true)
    const { rows: [r] } = await raw(`SELECT count(*)::int AS n FROM native_refresh_tokens WHERE user_id = $1`, [DOOMED])
    expect(r.n).toBe(0)
  })
})
