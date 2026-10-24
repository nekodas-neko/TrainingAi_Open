// #2858. The Oura Cloud token slice against a real Postgres, with no migration: the existing
// `oura_tokens` table (083, 087) holds the ciphertext. Insert then replace, the stored columns are
// the ciphertext and never the plaintext, a refresh keeps `oura_user_id`, `oura_user_id` stays
// unique across users, delete is scoped to its user, claude_ro withholds the token columns, and the
// row goes with the account.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { encryptOuraToken } from '@/lib/oura/cloud/token-cipher'

const canRun = !!process.env.DATABASE_URL
const USER_A = '00000000-0000-4000-8000-0000000285a1'
const USER_B = '00000000-0000-4000-8000-0000000285b1'

describe.skipIf(!canRun)('oura_tokens as the Oura Cloud token store (#2858)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const savedKey = process.env.OURA_TOKEN_KEY

  const raw = (sql: string, params: unknown[] = []) => pool.query(sql, params)
  const tokens = (userId: string, access: string, refresh: string) => ({
    accessToken: encryptOuraToken(access, userId, 'access_token'),
    refreshToken: encryptOuraToken(refresh, userId, 'refresh_token'),
  })

  beforeAll(async () => {
    process.env.OURA_TOKEN_KEY = 'k'.repeat(48)
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const id of [USER_A, USER_B]) {
      await raw(`DELETE FROM users WHERE id = $1`, [id])
      await raw(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')`,
        [id, `oura-cloud-${id.slice(-4)}@example.com`],
      )
    }
  })

  afterAll(async () => {
    process.env.OURA_TOKEN_KEY = savedKey
    if (!canRun) return
    await raw(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[USER_A, USER_B]])
  })

  it('stores ciphertext, never the plaintext, and reads it back as stored', async () => {
    const t = tokens(USER_A, 'plain-access-A', 'plain-refresh-A')
    await repo.saveOuraCloudTokens(USER_A, { ...t, expiresAt: new Date('2026-10-15T02:00:00Z'), scope: 'daily', ouraUserId: 'oura-A' })
    const { rows } = await raw(`SELECT access_token, refresh_token FROM oura_tokens WHERE user_id = $1`, [USER_A])
    expect(rows[0].access_token).toBe(t.accessToken)
    expect(JSON.stringify(rows[0])).not.toContain('plain-')
    expect(await repo.getOuraCloudTokens(USER_A)).toMatchObject({
      userId: USER_A, accessToken: t.accessToken, refreshToken: t.refreshToken, scope: 'daily', ouraUserId: 'oura-A',
    })
  })

  it('a refresh replaces the tokens and keeps oura_user_id', async () => {
    const t = tokens(USER_A, 'access-2', 'refresh-2')
    await repo.saveOuraCloudTokens(USER_A, { ...t, expiresAt: new Date('2026-10-16T02:00:00Z'), scope: 'daily' })
    const row = await repo.getOuraCloudTokens(USER_A)
    expect(row?.accessToken).toBe(t.accessToken)
    expect(row?.ouraUserId).toBe('oura-A')
    expect(row?.expiresAt?.toISOString()).toBe('2026-10-16T02:00:00.000Z')
  })

  // #3204
  it('marks a refused grant only while the row is unchanged, keeps the first time, and a save clears it', async () => {
    const before = await repo.getOuraCloudTokens(USER_A)
    expect(before?.reauthRequiredAt).toBeNull()
    // A save after the caller's read: the row holds other tokens, so it is not marked.
    const stale = new Date(before!.updatedAt.getTime() - 60_000)
    expect(await repo.markOuraCloudReauthRequired(USER_A, stale)).toBe(false)
    expect((await repo.getOuraCloudTokens(USER_A))?.reauthRequiredAt).toBeNull()

    expect(await repo.markOuraCloudReauthRequired(USER_A, before!.updatedAt)).toBe(true)
    const marked = await repo.getOuraCloudTokens(USER_A)
    expect(marked?.reauthRequiredAt).toBeInstanceOf(Date)
    // The tokens and their save time are left as they were.
    expect(marked?.accessToken).toBe(before?.accessToken)
    expect(marked?.updatedAt.getTime()).toBe(before!.updatedAt.getTime())
    await raw(`UPDATE oura_tokens SET reauth_required_at = '2026-10-20T00:00:00Z' WHERE user_id = $1`, [USER_A])
    expect(await repo.markOuraCloudReauthRequired(USER_A, before!.updatedAt)).toBe(true)
    expect((await repo.getOuraCloudTokens(USER_A))?.reauthRequiredAt?.toISOString()).toBe('2026-10-20T00:00:00.000Z')

    expect(await repo.markOuraCloudReauthRequired(USER_B, new Date())).toBe(false) // no row, nothing marked

    const t = tokens(USER_A, 'access-3', 'refresh-3')
    await repo.saveOuraCloudTokens(USER_A, { ...t, expiresAt: new Date('2026-10-17T02:00:00Z'), scope: 'daily', ouraUserId: 'oura-A' })
    expect((await repo.getOuraCloudTokens(USER_A))?.reauthRequiredAt).toBeNull()
  })

  it('refuses a second user for the same Oura account (23505)', async () => {
    const t = tokens(USER_B, 'b', 'b')
    await expect(repo.saveOuraCloudTokens(USER_B, { ...t, expiresAt: new Date(), scope: null, ouraUserId: 'oura-A' }))
      .rejects.toSatisfy((e: unknown) => (e as { cause?: { code?: string } }).cause?.code === '23505')
    expect(await repo.getOuraCloudTokens(USER_B)).toBeNull()
  })

  it('delete is scoped to its user', async () => {
    const t = tokens(USER_B, 'b', 'b')
    await repo.saveOuraCloudTokens(USER_B, { ...t, expiresAt: new Date(), scope: null, ouraUserId: 'oura-B' })
    expect(await repo.deleteOuraCloudTokens(USER_B)).toBe(true)
    expect(await repo.deleteOuraCloudTokens(USER_B)).toBe(false)
    expect(await repo.getOuraCloudTokens(USER_A)).not.toBeNull()
  })

  it('claude_ro withholds both token columns', async () => {
    const { rows } = await raw(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'claude_ro' AND table_name = 'oura_tokens'`,
    )
    if (rows.length === 0) return // views not installed in this database
    const cols = rows.map(r => r.column_name)
    expect(cols).not.toContain('access_token')
    expect(cols).not.toContain('refresh_token')
    expect(cols).toContain('reauth_required_at') // #3204: when the feed stopped is not a secret
  })

  it('the row goes with the account', async () => {
    await raw(`DELETE FROM users WHERE id = $1`, [USER_A])
    const { rows } = await raw(`SELECT 1 FROM oura_tokens WHERE user_id = $1`, [USER_A])
    expect(rows).toHaveLength(0)
  })
})
