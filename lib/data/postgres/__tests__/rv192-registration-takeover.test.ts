// RV-192 — an invited address could be taken by whoever registered it first, and kept.
//
// Registration activated any invited email with no proof the registrant owned the inbox. When the
// real owner later signed in with Google, Google was linked onto that account and the registrant's
// password kept working. Now a password registration starts inactive whatever the invite says, and
// linking Google clears the password, because Google proved the address and the password never did.
//
// Runs only against a real local dev Postgres; skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const EMAIL = 'rv192-invited@example.com'

describe.skipIf(!canRun)('registration cannot take an invited address (RV-192)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const cleanup = async () => {
    await pool.query(`DELETE FROM users WHERE email = $1`, [EMAIL])
    await pool.query(`DELETE FROM invited_emails WHERE lower(email) = $1`, [EMAIL])
  }

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await cleanup()
    await repo.addInvite(EMAIL)
  })
  afterAll(async () => { if (canRun) await cleanup() })

  it('a password registration on an invited address starts inactive', async () => {
    const u = await repo.createEmailUser(EMAIL, 'bcrypt-hash-of-someone-elses-password')
    expect(u.isActive).toBe(false)
  })

  it('linking Google clears the password the registrant set', async () => {
    const existing = (await repo.getUserByEmail(EMAIL))!
    expect(existing.passwordHash).toBeTruthy()
    await repo.linkOAuthAccount(existing.id, 'google-sub-rv192')
    const after = (await repo.getUserByEmail(EMAIL))!
    expect(after.passwordHash ?? null).toBeNull()
    expect(after.oauthSub).toBe('google-sub-rv192')
  })
})
