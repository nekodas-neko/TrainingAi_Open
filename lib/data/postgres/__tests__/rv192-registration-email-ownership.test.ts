import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const USER = '00000000-0000-4000-8000-000000192aaa'
const EMAIL = 'rv192-invited@example.com'
const canRun = !!process.env.DATABASE_URL

describe.skipIf(!canRun)('RV-192 — an invite is not proof of email ownership', () => {
  let pool: import('pg').Pool
  let repo: Awaited<ReturnType<typeof import('@/lib/data').getRepository>>

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query('DELETE FROM users WHERE email = $1', [EMAIL])
    await pool.query('DELETE FROM invited_emails WHERE email = $1', [EMAIL])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = $1 OR id = $2', [EMAIL, USER])
    await pool.query('DELETE FROM invited_emails WHERE email = $1', [EMAIL])
  })

  it('does not activate a password account just because the address was invited', async () => {
    await repo.addInvite(EMAIL)
    expect(await repo.isInvited(EMAIL)).toBe(true)   // the precondition, not an aside

    const created = await repo.createEmailUser(EMAIL, 'not-a-real-hash', 'RV-192 probe')
    expect(created.isActive).toBe(false)

    const { rows } = await pool.query('SELECT is_active FROM users WHERE email = $1', [EMAIL])
    expect(rows[0].is_active).toBe(false)
  })

  it('still lets an explicit isActive through, for the paths that have already checked', async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [EMAIL])
    const created = await repo.createEmailUser(EMAIL, 'not-a-real-hash', undefined, true)
    expect(created.isActive).toBe(true)
  })

  it('clears the password when an OAuth account is linked onto the row', async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [EMAIL])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'someone-elses-hash', 'Australia/Brisbane')`,
      [USER, EMAIL])

    const before = await repo.getUserByEmail(EMAIL)
    expect(before?.passwordHash).toBe('someone-elses-hash')

    await repo.linkOAuthAccount(USER, 'google-sub-rv192')

    const after = await repo.getUserByEmail(EMAIL)
    expect(after?.passwordHash).toBeUndefined()
    // The link itself must still happen — clearing the password instead of linking would lock
    // everyone out, which is the failure mode worth distinguishing from the fix.
    const { rows } = await pool.query('SELECT oauth_sub, password_hash FROM users WHERE id = $1', [USER])
    expect(rows[0].oauth_sub).toBe('google-sub-rv192')
    expect(rows[0].password_hash).toBeNull()
  })

  it('does not let a second Google identity replace the first', async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [EMAIL])
    await repo.createEmailUser(EMAIL, 'original-password')
    const user = await repo.getUserByEmail(EMAIL)
    expect(await repo.linkOAuthAccount(user!.id, 'google-sub-rv192-first')).toBe(true)
    await repo.updateUserPassword(user!.id, 'new-password')
    expect(await repo.linkOAuthAccount(user!.id, 'google-sub-rv192-second')).toBe(false)
    expect((await repo.getUserByOAuthSub('google-sub-rv192-first'))?.id).toBe(user!.id)
    expect((await repo.getUserCredentials(user!.id))?.passwordHash).toBe('new-password')
  })

  it('guards an email collision in the atomic OAuth upsert', async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [EMAIL])
    const user = await repo.createEmailUser(EMAIL, 'unverified-password')
    const first = await repo.upsertUser({ email: EMAIL, oauthSub: 'google-sub-rv192-upsert', timezone: 'Australia/Brisbane' })
    expect(first.id).toBe(user.id)
    expect((await repo.getUserCredentials(user.id))?.passwordHash).toBeUndefined()
    await expect(repo.upsertUser({ email: EMAIL, oauthSub: 'google-sub-rv192-conflict', timezone: 'Australia/Brisbane' }))
      .rejects.toThrow('already linked')
    expect((await repo.getUserByOAuthSub('google-sub-rv192-upsert'))?.id).toBe(user.id)
  })
})
