import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// #3951: `/api/admin/errors` and `/api/admin/feedback` hold every account's rows, so an admin
// session reads them only when it is the owner's, as db-query and db-snapshot (#3657). Real accounts
// and real rows: only the session is supplied (`@/auth`), so `requireAdmin` and the owner check read
// the seeded users, and the routes read the seeded error events and feedback.
const OWNER = '00000000-0000-4000-8000-00000395100f'
const ADMIN = '00000000-0000-4000-8000-00000395101a'
const PLAIN = '00000000-0000-4000-8000-00000395102b'
const USERS = [OWNER, ADMIN, PLAIN]
const MARK = 'owner-only-3951'

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; isAdmin?: boolean } } }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => session.current) }))
const asUser = (id: string) => { session.current = { user: { id, isAdmin: true } } }

const canRun = !!process.env.DATABASE_URL

const errors = async () => (await import('@/app/api/admin/errors/route')).GET()
const feedback = async () => (await import('@/app/api/admin/feedback/route')).GET()
const pending = async () => (await import('@/app/api/admin/pending-count/route')).GET()
const deleteFeedback = async (id: string) => (await import('@/app/api/admin/feedback/[id]/route')).DELETE(
  new NextRequest(`http://localhost/api/admin/feedback/${id}`, { method: 'DELETE' }),
  { params: Promise.resolve({ id }) },
)

describe.skipIf(!canRun)('admin errors and feedback: an admin session must be the owner (#3951)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const seededFeedbackIds = async () =>
    (await pool.query<{ id: string }>('SELECT id FROM feedback_submissions WHERE user_id = ANY($1::uuid[]) ORDER BY title', [USERS])).rows.map(r => r.id)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [USERS])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active) VALUES
         ($1, 'reports-owner-3951@example.com', 'x', 'Australia/Brisbane', true,  true),
         ($2, 'reports-admin-3951@example.com', 'x', 'Australia/Brisbane', true,  true),
         ($3, 'reports-plain-3951@example.com', 'x', 'Australia/Brisbane', false, true)`,
      USERS)
  })

  beforeEach(async () => {
    vi.stubEnv('CLAUDE_RO_OWNER_USER_ID', OWNER)
    await pool.query('UPDATE users SET is_admin = (id <> $2), is_active = true WHERE id = ANY($1::uuid[])', [USERS, PLAIN])
    await pool.query('DELETE FROM feedback_submissions WHERE user_id = ANY($1::uuid[])', [USERS])
    await pool.query('DELETE FROM error_events WHERE user_id = ANY($1::uuid[])', [USERS])
    // One row from each account, through the app's own writes.
    for (const [i, id] of USERS.entries()) {
      await repo.createFeedback(id, { type: 'bug', title: `${MARK} feedback ${i}`, description: 'seeded' })
      await repo.insertErrorEvent({ userId: id, source: 'client', message: `${MARK} error ${i}`, url: '/seeded' })
    }
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await pool.query('DELETE FROM feedback_submissions WHERE user_id = ANY($1::uuid[])', [USERS])
    await pool.query('DELETE FROM error_events WHERE user_id = ANY($1::uuid[])', [USERS])
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [USERS])
  })

  it('the owner gets every account\'s error events and feedback', async () => {
    asUser(OWNER)
    const e = await errors()
    expect(e.status).toBe(200)
    const events = (await e.json() as { message: string }[]).map(r => r.message).filter(m => m.startsWith(MARK)).sort()
    expect(events).toEqual([`${MARK} error 0`, `${MARK} error 1`, `${MARK} error 2`])

    const f = await feedback()
    expect(f.status).toBe(200)
    const titles = (await f.json() as { title: string }[]).map(r => r.title).filter(t => t.startsWith(MARK)).sort()
    expect(titles).toEqual([`${MARK} feedback 0`, `${MARK} feedback 1`, `${MARK} feedback 2`])
  })

  it('a second, fully active admin is refused by both with the owner-only routes\' 403 body', async () => {
    asUser(ADMIN)
    for (const res of [await errors(), await feedback()]) {
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'Forbidden' })
    }
  })

  it('a second admin cannot delete feedback either, and the row stays', async () => {
    const [first] = await seededFeedbackIds()
    asUser(ADMIN)
    const res = await deleteFeedback(first)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
    expect(await seededFeedbackIds()).toContain(first)

    asUser(OWNER)
    expect((await deleteFeedback(first)).status).toBe(200)
    expect(await seededFeedbackIds()).not.toContain(first)
  })

  // The pending-user count is of every inactive account in the database, and other test files add and
  // remove inactive users in the same database while the suite runs in parallel (#4012), so two
  // requests can see different totals. This test therefore never compares two live counts. It checks
  // the two things it is about: the count the route reports is the count the repository gives, the
  // same for both roles; and a count of inactive users this test seeded itself is included.
  it('the pending badge counts feedback for the owner only; inactive users still count for any admin', async () => {
    const SEEDED = [
      '00000000-0000-4000-8000-00000401201a',
      '00000000-0000-4000-8000-00000401202b',
      '00000000-0000-4000-8000-00000401203c',
    ]
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [SEEDED])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active)
       SELECT id, 'pending-badge-4012-' || n || '@example.com', 'x', 'Australia/Brisbane', false, false
       FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, n)`,
      [SEEDED])
    try {
      // Real database: both roles count at least the inactive users seeded here (others may add more).
      asUser(OWNER)
      const owner = await (await pending()).json() as { count: number; feedbackCount: number }
      expect(owner.feedbackCount).toBeGreaterThanOrEqual(3)
      expect(owner.count).toBeGreaterThanOrEqual(SEEDED.length)
      asUser(ADMIN)
      const res = await pending()
      expect(res.status).toBe(200)
      const other = await res.json() as { count: number; feedbackCount: number }
      expect(other.feedbackCount).toBe(0)
      expect(other.count).toBeGreaterThanOrEqual(SEEDED.length)

      // One fixed count source, so the two roles must agree whatever other files do meanwhile.
      const spy = vi.spyOn(repo, 'countPendingApprovalUsers').mockResolvedValue(7)
      try {
        asUser(OWNER)
        expect((await (await pending()).json() as { count: number }).count).toBe(7)
        asUser(ADMIN)
        expect(await (await pending()).json()).toEqual({ count: 7, feedbackCount: 0 })
      } finally {
        spy.mockRestore()
      }
    } finally {
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [SEEDED])
    }
  })

  it('a non-admin gets the same 403, and no session a 401', async () => {
    asUser(PLAIN)
    expect((await errors()).status).toBe(403)
    expect((await feedback()).status).toBe(403)
    session.current = null
    expect((await errors()).status).toBe(401)
    expect((await feedback()).status).toBe(401)
  })

  it('the owner\'s row is re-read on every call: an owner demoted from admin is refused', async () => {
    await pool.query('UPDATE users SET is_admin = false WHERE id = $1', [OWNER])
    asUser(OWNER)
    expect((await errors()).status).toBe(403)
    expect((await feedback()).status).toBe(403)
  })

  it('fails closed when the owner cannot be resolved: even the configured account is refused', async () => {
    for (const k of ['CLAUDE_RO_OWNER_USER_ID', 'ADMIN_EXPORT_USER_ID', 'WEBHOOK_USER_ID']) vi.stubEnv(k, '')
    asUser(OWNER)
    expect((await errors()).status).toBe(403)
    expect((await feedback()).status).toBe(403)
  })

  // #3957 review: a database error during the owner lookup is "try again", 503, never "owner only".
  // Only the owner lookup's `getUserById` (called from `resolveOwnerUserId`) rejects; `requireAdmin`
  // still reads the owner's row, so each request gets past the admin check and fails on the owner.
  describe('when the owner lookup throws', () => {
    const failOwnerLookup = () => {
      const real = repo.getUserById.bind(repo)
      vi.spyOn(console, 'error').mockImplementation(() => {})
      return vi.spyOn(repo, 'getUserById').mockImplementation(async (id: string) => {
        if (new Error().stack?.includes('resolveOwnerUserId')) throw new Error('connection terminated unexpectedly')
        return real(id)
      })
    }

    it('errors, feedback, feedback/[id] and the pending badge answer 503 with no data', async () => {
      const [first] = await seededFeedbackIds()
      const spy = failOwnerLookup()
      try {
        asUser(OWNER)
        for (const res of [await errors(), await feedback(), await deleteFeedback(first), await pending()]) {
          expect(res.status).toBe(503)
          expect(await res.json()).toEqual({ error: 'Service unavailable' })
        }
      } finally {
        spy.mockRestore()
      }
      // The refused delete removed nothing, and the owner gets through once the lookup answers.
      expect(await seededFeedbackIds()).toContain(first)
      expect((await errors()).status).toBe(200)
      expect((await pending()).status).toBe(200)
    })
  })
})
