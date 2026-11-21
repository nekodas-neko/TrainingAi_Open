// #3829, against a real Postgres: every path that clears a password on a link sets
// `users.sign_ins_valid_from` in the same transaction, a link that keeps the password sets nothing,
// and the data epoch (`sessions_valid_from`) is never touched, so no phone wipes its store.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const ME = '00000000-0000-4000-8000-000000382901'
const OTHER = '00000000-0000-4000-8000-000000382902'
const EMAIL = 'link-3829@example.com'
const OTHER_EMAIL = 'link-3829-other@example.com'
const SUB = 'google-sub-3829'

describe.skipIf(!canRun)('#3829 — a link that clears the password sets the sign-in cut-off', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const raw = (q: string, p: unknown[] = []) => pool.query(q, p)
  const cutoffs = async (id: string) => (await raw(
    `SELECT sign_ins_valid_from AS s, sessions_valid_from AS d FROM users WHERE id = $1`, [id])).rows[0] as { s: Date | null; d: Date | null }

  const clean = async () => {
    await raw(`DELETE FROM users WHERE id = ANY($1::uuid[]) OR email = ANY($2::text[])`, [[ME, OTHER], [EMAIL, OTHER_EMAIL]])
  }
  const passwordAccount = async (id: string, email: string, active = true) => raw(
    `INSERT INTO users (id, email, password_hash, is_active, timezone) VALUES ($1, $2, 'a-hash', $3, 'Australia/Brisbane')`,
    [id, email, active])
  // #3949 review N1: the cut-off is the database clock's next whole second after the write, so it
  // is a whole second, after the call began, and at most a second past its end.
  const within = (at: Date | null, before: number) => {
    expect(at).not.toBeNull()
    expect(at!.getTime() % 1000).toBe(0)
    expect(at!.getTime()).toBeGreaterThan(before)
    expect(at!.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
  })
  beforeEach(clean)
  afterAll(async () => { if (canRun) await clean() })

  it('the Google link sets it to now, and only on that account; the data epoch is untouched', async () => {
    await passwordAccount(ME, EMAIL)
    await passwordAccount(OTHER, OTHER_EMAIL)
    const before = Date.now()
    expect(await repo.linkOAuthAccount(ME, SUB)).toBe(true)
    const mine = await cutoffs(ME)
    within(mine.s, before)
    expect(mine.d).toBeNull()
    expect(await cutoffs(OTHER)).toEqual({ s: null, d: null })
    // What the claim check reads.
    expect((await repo.getUserById(ME))?.signInsValidFrom?.getTime()).toBe(mine.s!.getTime())
  })

  it('a link that keeps the password (another method already linked) sets nothing', async () => {
    await passwordAccount(ME, EMAIL)
    await raw(`INSERT INTO auth_identities (user_id, provider, subject) VALUES ($1, 'apple', 'apple-sub-3829k')`, [ME])
    expect(await repo.linkOAuthAccount(ME, SUB)).toBe(true)
    expect(await cutoffs(ME)).toEqual({ s: null, d: null })
  })

  it('never moves the cut-off back, and always past an earlier one', async () => {
    await passwordAccount(ME, EMAIL)
    const later = new Date(Math.floor(Date.now() / 1000) * 1000 + 3_600_000)
    await raw(`UPDATE users SET sign_ins_valid_from = $2 WHERE id = $1`, [ME, later])
    await repo.linkOAuthAccount(ME, SUB)
    // A sign-in stamped at the earlier cut-off is ended by this one (#3949 review N1).
    expect((await cutoffs(ME)).s?.getTime()).toBe(later.getTime() + 1000)
  })

  it('the upsert\'s email collision sets it too', async () => {
    await passwordAccount(ME, EMAIL)
    const before = Date.now()
    const linked = await repo.upsertUser({ email: EMAIL, oauthSub: SUB, timezone: 'Australia/Brisbane' }, true)
    expect(linked.id).toBe(ME)
    const mine = await cutoffs(ME)
    within(mine.s, before)
    expect(mine.d).toBeNull()
  })

  it('a returning Google user\'s upsert sets nothing', async () => {
    await raw(`INSERT INTO users (id, email, oauth_sub, is_active, timezone) VALUES ($1, $2, $3, true, 'Australia/Brisbane')`, [ME, EMAIL, SUB])
    await repo.upsertUser({ email: EMAIL, oauthSub: SUB, timezone: 'Australia/Brisbane' }, false)
    expect(await cutoffs(ME)).toEqual({ s: null, d: null })
  })

  it('Apple\'s link onto an inactive password account sets it too', async () => {
    await passwordAccount(ME, EMAIL, false)
    const before = Date.now()
    const user = await repo.createProviderUser('apple', 'apple-sub-3829', EMAIL)
    expect(user.id).toBe(ME)
    const mine = await cutoffs(ME)
    within(mine.s, before)
    expect(mine.d).toBeNull()
  })

  it('a missing row fails the write rather than leaving old sign-ins valid', async () => {
    const { endSignInsBefore } = await import('@/lib/data/postgres/slices/auth')
    const { getDb } = await import('@/lib/data/postgres/client')
    await expect(endSignInsBefore(getDb(), ME)).rejects.toThrow('sign-in cut-off was not recorded')
  })
})
