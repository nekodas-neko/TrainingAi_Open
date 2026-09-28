// LA-61 — the repository normalises an email on the way in and matches stored rows by lower(email),
// so `Alice@x.com` and `alice@x.com` are one account and one invite. The lookups use lower() rather
// than an exact match so a row the migration could not normalise (a collision it deliberately left
// alone) is still found.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL

describe.skipIf(!canRun)('email normalisation at the repository boundary (LA-61)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const cleanup = async () => {
    await pool.query(`DELETE FROM users WHERE lower(email) LIKE '%la61-repo%'`)
    await pool.query(`DELETE FROM invited_emails WHERE lower(email) LIKE '%la61-repo%'`)
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await cleanup()
  })

  afterAll(async () => { if (canRun) await cleanup() })

  it('finds a stored mixed-case account from any spelling', async () => {
    await pool.query(`INSERT INTO users (email, password_hash) VALUES ('Legacy.LA61-repo@Example.com', 'x')`)
    const u = await repo.getUserByEmail('  legacy.la61-REPO@example.COM ')
    expect(u?.email).toBe('Legacy.LA61-repo@Example.com')
  })

  it('stores a new email-and-password account normalised', async () => {
    const u = await repo.createEmailUser('  New.LA61-repo@Example.com ', 'x')
    expect(u.email).toBe('new.la61-repo@example.com')
    expect((await repo.getUserByEmail('NEW.la61-repo@example.com'))?.id).toBe(u.id)
  })

  it('stores an OAuth account normalised, and a second spelling reaches the same row', async () => {
    const a = await repo.upsertUser({ email: 'OAuth.LA61-repo@Example.com', name: null, oauthSub: null } as never, true)
    const b = await repo.upsertUser({ email: 'oauth.la61-repo@example.com', name: null, oauthSub: null } as never, true)
    expect(a.email).toBe('oauth.la61-repo@example.com')
    expect(b.id).toBe(a.id)
  })

  it('invites are one address regardless of case — added, checked and removed', async () => {
    await repo.addInvite('Inv.LA61-repo@Example.com')
    expect((await pool.query(`SELECT email FROM invited_emails WHERE lower(email) = 'inv.la61-repo@example.com'`)).rows)
      .toEqual([{ email: 'inv.la61-repo@example.com' }])
    expect(await repo.isInvited(' INV.la61-repo@example.com')).toBe(true)
    await repo.removeInvite('inv.LA61-REPO@example.com')
    expect(await repo.isInvited('inv.la61-repo@example.com')).toBe(false)
  })

  it('a stored mixed-case invite still counts, and can still be removed', async () => {
    await pool.query(`INSERT INTO invited_emails (email) VALUES ('Old.LA61-repo@Example.com')`)
    expect(await repo.isInvited('old.la61-repo@example.com')).toBe(true)
    await repo.removeInvite('old.la61-repo@example.com')
    expect(await repo.isInvited('Old.LA61-repo@Example.com')).toBe(false)
  })
})
