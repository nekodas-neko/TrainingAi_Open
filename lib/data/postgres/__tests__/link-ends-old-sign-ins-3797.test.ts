// #3797 item 1 and 3, against a real Postgres: a link that clears a password ends that password's
// native sign-ins in the same transaction; a link that keeps it ends nothing; another account's
// sign-ins are untouched; a sign-in made after the link (the linking request's own) is live; an
// invited, verified address is activated on the link path, and nothing is ever deactivated.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { randomBytes } from 'crypto'
import { hashRefreshToken } from '@/lib/auth/refresh-token-hash'

const canRun = !!process.env.DATABASE_URL
const ME = '00000000-0000-4000-8000-000000379701'
const OTHER = '00000000-0000-4000-8000-000000379702'
const EMAIL = 'link-3797@example.com'
const OTHER_EMAIL = 'link-3797-other@example.com'
const SUB = 'google-sub-3797'

describe.skipIf(!canRun)('#3797 — linking Google ends the cleared password\'s sign-ins', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const raw = (q: string, p: unknown[] = []) => pool.query(q, p)
  const token = (userId: string) => repo.createNativeRefreshToken({
    userId, tokenHash: hashRefreshToken(randomBytes(32).toString('base64url'))!,
    deviceLabel: 'Galaxy S25 Ultra', expiresAt: new Date(Date.now() + 30 * 86_400_000),
  })
  const live = async (userId: string) => (await raw(
    `SELECT count(*)::int AS n FROM native_refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, [userId])).rows[0].n
  const reasons = async (userId: string) => (await raw(
    `SELECT DISTINCT revoked_reason FROM native_refresh_tokens WHERE user_id = $1`, [userId])).rows.map(r => r.revoked_reason)

  const clean = async () => {
    await raw(`DELETE FROM users WHERE id = ANY($1::uuid[]) OR email = ANY($2::text[])`, [[ME, OTHER], [EMAIL, OTHER_EMAIL]])
    await raw(`DELETE FROM invited_emails WHERE email = ANY($1::text[])`, [[EMAIL, OTHER_EMAIL]])
  }
  const passwordAccount = async (id: string, email: string, active = true) => raw(
    `INSERT INTO users (id, email, password_hash, is_active, timezone) VALUES ($1, $2, 'a-hash', $3, 'Australia/Brisbane')`,
    [id, email, active])

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
  })
  beforeEach(clean)
  afterAll(async () => { if (canRun) await clean() })

  it('revokes every native sign-in of the account when the link clears its password, and no other account\'s', async () => {
    await passwordAccount(ME, EMAIL)
    await passwordAccount(OTHER, OTHER_EMAIL)
    const first = await token(ME)
    await token(ME)
    // A rotated chain: the rotated row and its successor both end.
    await repo.rotateNativeRefreshToken({
      userId: ME, id: first.id, newTokenHash: hashRefreshToken(randomBytes(32).toString('base64url'))!,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    })
    await token(OTHER)
    expect(await live(ME)).toBe(3)

    expect(await repo.linkOAuthAccount(ME, SUB)).toBe(true)

    expect(await live(ME)).toBe(0)
    expect(await reasons(ME)).toEqual(['password_change'])
    expect(await live(OTHER)).toBe(1)
    const { rows } = await raw(`SELECT oauth_sub, password_hash FROM users WHERE id = $1`, [ME])
    expect(rows[0]).toEqual({ oauth_sub: SUB, password_hash: null })
  })

  it('leaves a sign-in made after the link live: the linking request\'s own', async () => {
    await passwordAccount(ME, EMAIL)
    await token(ME)
    await repo.linkOAuthAccount(ME, SUB)
    const after = await token(ME)
    expect((await repo.findNativeRefreshTokenById(ME, after.id))?.revokedAt).toBeNull()
    expect(await live(ME)).toBe(1)
  })

  it('ends nothing when the password is kept because another sign-in method was already linked', async () => {
    await passwordAccount(ME, EMAIL)
    await raw(`INSERT INTO auth_identities (user_id, provider, subject) VALUES ($1, 'apple', 'apple-sub-3797')`, [ME])
    await token(ME)
    expect(await repo.linkOAuthAccount(ME, SUB)).toBe(true)
    expect(await live(ME)).toBe(1)
    const { rows } = await raw(`SELECT password_hash FROM users WHERE id = $1`, [ME])
    expect(rows[0].password_hash).toBe('a-hash')
  })

  it('changes nothing, and revokes nothing, when the account is already linked', async () => {
    await passwordAccount(ME, EMAIL)
    await raw(`UPDATE users SET oauth_sub = 'someone-first' WHERE id = $1`, [ME])
    await token(ME)
    expect(await repo.linkOAuthAccount(ME, SUB)).toBe(false)
    expect(await live(ME)).toBe(1)
    const { rows } = await raw(`SELECT oauth_sub, password_hash FROM users WHERE id = $1`, [ME])
    expect(rows[0]).toEqual({ oauth_sub: 'someone-first', password_hash: 'a-hash' })
  })

  it('activates on the link path only when asked (verified and invited), and never deactivates', async () => {
    await passwordAccount(ME, EMAIL, false)
    await repo.linkOAuthAccount(ME, SUB)
    expect((await repo.getUserById(ME))?.isActive).toBe(false)

    await clean()
    await passwordAccount(ME, EMAIL, false)
    await repo.linkOAuthAccount(ME, SUB, { activate: true })
    expect((await repo.getUserById(ME))?.isActive).toBe(true)

    await clean()
    await passwordAccount(ME, EMAIL, true)
    await repo.linkOAuthAccount(ME, SUB, { activate: false })
    expect((await repo.getUserById(ME))?.isActive).toBe(true)
  })

  it('the upsert\'s email collision is a link too: it ends the cleared password\'s sign-ins and honours the invite', async () => {
    await passwordAccount(ME, EMAIL, false)
    await passwordAccount(OTHER, OTHER_EMAIL)
    await raw(`UPDATE users SET is_active = true WHERE id = $1`, [ME])
    await token(ME)
    await raw(`UPDATE users SET is_active = false WHERE id = $1`, [ME])
    await token(OTHER)

    const linked = await repo.upsertUser({ email: EMAIL, oauthSub: SUB, timezone: 'Australia/Brisbane' }, true)
    expect(linked.id).toBe(ME)
    expect(linked.isActive).toBe(true)
    expect(await live(ME)).toBe(0)
    expect(await live(OTHER)).toBe(1)
  })

  it('the upsert does not activate an uninvited address, and a returning user\'s upsert ends nothing', async () => {
    await passwordAccount(ME, EMAIL, false)
    const linked = await repo.upsertUser({ email: EMAIL, oauthSub: SUB, timezone: 'Australia/Brisbane' }, false)
    expect(linked.isActive).toBe(false)

    await raw(`UPDATE users SET is_active = true WHERE id = $1`, [ME])
    await token(ME)
    await repo.upsertUser({ email: EMAIL, oauthSub: SUB, timezone: 'Australia/Brisbane' }, false)
    expect(await live(ME)).toBe(1)
    expect((await repo.getUserById(ME))?.isActive).toBe(true)
  })

  it('Apple\'s link onto an inactive password account ends that password\'s sign-ins too', async () => {
    await passwordAccount(ME, EMAIL, false)
    await token(ME)
    const user = await repo.createProviderUser('apple', 'apple-sub-3797', EMAIL)
    expect(user.id).toBe(ME)
    expect(await live(ME)).toBe(0)
  })

  // #3830: the Apple link applies the invite only when the caller says it may.
  it('Apple\'s link activates a pending invited account when told to, and only then', async () => {
    await passwordAccount(ME, EMAIL, false)
    const pending = await repo.createProviderUser('apple', 'apple-sub-3830a', EMAIL, undefined, { activate: false })
    expect(pending.id).toBe(ME)
    expect(pending.isActive).toBe(false)
    expect((await repo.getUserById(ME))?.isActive).toBe(false)

    await raw(`DELETE FROM users WHERE id = $1`, [ME])
    await passwordAccount(ME, EMAIL, false)
    const active = await repo.createProviderUser('apple', 'apple-sub-3830b', EMAIL, undefined, { activate: true })
    expect(active.id).toBe(ME)
    expect(active.isActive).toBe(true)
    expect((await repo.getUserById(ME))?.isActive).toBe(true)
  })

  it('Apple\'s path leaves an already-active account unchanged', async () => {
    await passwordAccount(ME, EMAIL, true)
    await expect(repo.createProviderUser('apple', 'apple-sub-3830c', EMAIL, undefined, { activate: true })).rejects.toThrow()
    const row = (await raw(`SELECT is_active, password_hash FROM users WHERE id = $1`, [ME])).rows[0]
    expect(row).toEqual({ is_active: true, password_hash: 'a-hash' })
    expect((await raw(`SELECT count(*)::int AS n FROM auth_identities WHERE user_id = $1`, [ME])).rows[0].n).toBe(0)
  })

  it('reports when the newest sign-in method was linked', async () => {
    await passwordAccount(ME, EMAIL)
    expect(await repo.getLatestIdentityLinkedAt(ME)).toBeNull()
    const before = Date.now()
    await repo.linkOAuthAccount(ME, SUB)
    const at = await repo.getLatestIdentityLinkedAt(ME)
    expect(at).toBeInstanceOf(Date)
    expect(Math.abs(at!.getTime() - before)).toBeLessThan(60_000)
  })
})
