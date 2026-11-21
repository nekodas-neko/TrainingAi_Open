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

  it('the pending badge counts feedback for the owner only; inactive users still count for any admin', async () => {
    asUser(OWNER)
    const owner = await (await pending()).json() as { count: number; feedbackCount: number }
    expect(owner.feedbackCount).toBeGreaterThanOrEqual(3)
    asUser(ADMIN)
    const res = await pending()
    expect(res.status).toBe(200)
    const other = await res.json() as { count: number; feedbackCount: number }
    expect(other).toEqual({ count: owner.count, feedbackCount: 0 })
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
})
