// RV-192 — registering with an invited address activated the account, and nothing proved the
// registrant could read that inbox.
//
// The path, end to end: an attacker who knows an address the owner has invited registers it with a
// password. `createEmailUser` defaulted `isActive` to `isInvited(email)`, so the account came up
// ACTIVE. When the real invitee later signs in with Google, the signIn callback links Google onto
// that same row — and left `password_hash` in place, so the attacker's password kept working on an
// account the invitee is now using.
//
// Two changes, each closing one half, and each asserted here against a real Postgres because both
// are single statements in the adapter: a mock of the adapter would only restate the change.
//
//   1. A password account starts INACTIVE. Google sign-in still honours the invite (`upsertUser`),
//      because there Google has verified the address; here nothing has.
//   2. Linking an OAuth account CLEARS the password.
//
// What this does NOT do is verify email — there is no mail-sending path in this repo at all, and
// adding one is infrastructure plus a product decision. Recorded on the entry; the owner's.
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

  it('leaves a cleared password unusable rather than blank-accepting', async () => {
    // auth.ts's credentials provider returns null on a falsy hash, so a null column is a refusal
    // and not an empty password that bcrypt might compare against. Pinned because the whole fix
    // rests on it: clearing the hash would be worse than useless if null meant "no password
    // required".
    const src = await import('fs').then((fs) => fs.readFileSync('auth.ts', 'utf8'))
    expect(src).toContain('if (!user?.passwordHash) return null')
  })
})
