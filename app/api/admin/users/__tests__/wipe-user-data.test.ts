import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// #3369 — an admin resets a user's data or deletes an account that has data. Every outcome is read
// back from the database: a refusal that still removed something would pass a status-only test.
const ADMIN = '00000000-0000-4000-8000-0000003369a1'
const OTHER_ADMIN = '00000000-0000-4000-8000-0000003369a2'
const PERSON = '00000000-0000-4000-8000-0000003369b1'    // non-admin holding data
const GONE = '00000000-0000-4000-8000-0000003369b2'      // non-admin holding data, deleted
const PLAIN = '00000000-0000-4000-8000-0000003369c1'     // not an admin

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; isAdmin?: boolean } } }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => session.current) }))
const revoke = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock('@/lib/account/revoke-oura-grant', () => ({
  // The token stands in as the user's id: read before the wipe, revoked only once it has committed.
  readOuraGrantBestEffort: vi.fn(async (_repo: unknown, userId: string) => userId),
  revokeOuraGrantAfterCommit: vi.fn(async (token: string | null) => { if (token) revoke.calls.push(token) }),
}))
const limiter = vi.hoisted(() => ({ allow: true }))
vi.mock('@/lib/rate-limit', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit: vi.fn(() => limiter.allow),
}))

const canRun = !!process.env.DATABASE_URL
const email = (id: string) => `wipe-3369-${id.slice(-4)}@example.com`
let runStart = new Date(0)

const post = (body: unknown) => new NextRequest('http://localhost/api/admin/users/reset-data', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const del = (body: unknown) => new NextRequest('http://localhost/api/admin/users', {
  method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

describe.skipIf(!canRun)('admin reset and delete of a user\'s data (#3369)', () => {
  let pool: import('pg').Pool
  const ids = [ADMIN, OTHER_ADMIN, PERSON, GONE, PLAIN]
  const metrics = async (id: string) =>
    (await pool.query('SELECT count(*)::int AS n FROM body_metrics WHERE user_id = $1', [id])).rows[0].n as number
  const exists = async (id: string) => (await pool.query('SELECT 1 FROM users WHERE id = $1', [id])).rowCount === 1
  // The log is append-only, so earlier tests' rows are still there: ask about one target at a time.
  const audit = async (job: string, target: string) => (await pool.query(
    `SELECT * FROM agent_action_log WHERE job = $1 AND actor = $2 AND started_at >= $3 AND parameters->>'targetUserId' = $4
     ORDER BY started_at DESC`,
    [job, `admin:${ADMIN}`, runStart, target])).rows

  async function cleanup() {
    await pool.query('DELETE FROM body_metrics WHERE user_id = ANY($1::uuid[])', [ids])
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids])
  }
  async function seed() {
    await cleanup()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active, display_name) VALUES
         ($1, $6, 'x', 'Australia/Brisbane', true,  true, 'Admin'),
         ($2, $7, 'x', 'Australia/Brisbane', true,  true, 'Other admin'),
         ($3, $8, 'x', 'Australia/Brisbane', false, true, 'Person'),
         ($4, $9, 'x', 'Australia/Brisbane', false, true, 'Gone'),
         ($5, $10, 'x', 'Australia/Brisbane', false, true, 'Plain')`,
      [ADMIN, OTHER_ADMIN, PERSON, GONE, PLAIN, ...[ADMIN, OTHER_ADMIN, PERSON, GONE, PLAIN].map(email)])
    for (const id of [ADMIN, OTHER_ADMIN, PERSON, GONE]) {
      await pool.query(`INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, '2026-09-20', 80)`, [id])
    }
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    runStart = (await pool.query<{ t: Date }>(`SELECT clock_timestamp() AS t`)).rows[0].t
  })
  beforeEach(async () => {
    limiter.allow = true
    revoke.calls.length = 0
    vi.stubEnv('CLAUDE_RO_OWNER_USER_ID', ADMIN)   // ADMIN is the owner; OTHER_ADMIN is an ordinary admin
    session.current = { user: { id: ADMIN, isAdmin: true } }
    await seed()
  })
  afterAll(async () => { vi.unstubAllEnvs(); if (canRun) await cleanup() })

  describe('POST /api/admin/users/reset-data', () => {
    it('resets the data, keeps the account, signs the user out and records who did it', async () => {
      const { POST } = await import('@/app/api/admin/users/reset-data/route')
      const res = await POST(post({ userId: PERSON, confirmEmail: email(PERSON) }) as never)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toMatchObject({ ok: true, reset: true, signedOut: false, defaultsSeeded: true })
      expect(res.headers.get('set-cookie')).toBeNull()
      expect(body.removedRows).toBeGreaterThan(0)
      expect(await metrics(PERSON)).toBe(0)
      expect(await exists(PERSON)).toBe(true)
      const { rows: [u] } = await pool.query('SELECT is_active, is_admin, display_name, sessions_valid_from FROM users WHERE id = $1', [PERSON])
      expect(u).toMatchObject({ is_active: true, is_admin: false, display_name: null })
      expect(u.sessions_valid_from).toBeInstanceOf(Date)
      expect(revoke.calls).toEqual([PERSON])
      const [row] = await audit('admin-reset-user-data', PERSON)
      expect(row).toMatchObject({ target_user_id: PERSON, outcome: 'succeeded' })
      expect(row.parameters.removed.body_metrics).toBe(1)
      // Everyone else is untouched.
      expect(await metrics(ADMIN)).toBe(1)
      expect(await metrics(OTHER_ADMIN)).toBe(1)
    })

    it('lets an admin reset themselves, keeping the admin flag, and tells the screen to sign out', async () => {
      const { POST } = await import('@/app/api/admin/users/reset-data/route')
      const res = await POST(post({ userId: ADMIN, confirmEmail: email(ADMIN).toUpperCase() }) as never)
      expect(res.status).toBe(200)
      expect((await res.json()).signedOut).toBe(true)
      expect(await metrics(ADMIN)).toBe(0)
      // The browser's cookie is expired on the same response, so this phone stops sending the dead token.
      expect(res.headers.get('set-cookie')).toMatch(/authjs\.session-token=;/)
      const { rows: [u] } = await pool.query('SELECT is_admin, is_active FROM users WHERE id = $1', [ADMIN])
      expect(u).toMatchObject({ is_admin: true, is_active: true })
    })

    it('resetting yourself by an upper-case copy of your id is still a self reset, not "another admin"', async () => {
      const { POST } = await import('@/app/api/admin/users/reset-data/route')
      const res = await POST(post({ userId: ADMIN.toUpperCase(), confirmEmail: email(ADMIN) }) as never)
      expect(res.status).toBe(200)
      expect(await metrics(ADMIN)).toBe(0)
      expect(await exists(ADMIN)).toBe(true)
    })

    it('demote-then-wipe: another admin cannot demote the owner, and wiping a demoted owner is refused', async () => {
      session.current = { user: { id: OTHER_ADMIN, isAdmin: true } }
      const users = await import('@/app/api/admin/users/route')
      const { POST } = await import('@/app/api/admin/users/reset-data/route')
      const demote = await users.PATCH(new NextRequest('http://localhost/api/admin/users', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: ADMIN, action: 'revoke-admin' }),
      }) as never)
      expect(demote.status).toBe(403)
      // Even with the flag stripped by some other route to it (a direct write), the owner id protects him.
      await pool.query('UPDATE users SET is_admin = false WHERE id = $1', [ADMIN])
      const reset = await POST(post({ userId: ADMIN, confirmEmail: email(ADMIN) }) as never)
      expect(reset.status).toBe(403)
      const erase = await users.DELETE(del({ userId: ADMIN, confirmEmail: email(ADMIN) }) as never)
      expect(erase.status).toBe(403)
      expect(await metrics(ADMIN)).toBe(1)
      expect(await exists(ADMIN)).toBe(true)
      expect(revoke.calls).toEqual([])
      const { rows } = await pool.query(
        `SELECT 1 FROM agent_action_log WHERE actor = $1 AND started_at >= $2`, [`admin:${OTHER_ADMIN}`, runStart])
      expect(rows).toHaveLength(0)
    })

    it('403 for every admin account when the owner cannot be resolved, yours included', async () => {
      for (const k of ['CLAUDE_RO_OWNER_USER_ID', 'ADMIN_EXPORT_USER_ID', 'WEBHOOK_USER_ID']) vi.stubEnv(k, '')
      const { POST } = await import('@/app/api/admin/users/reset-data/route')
      expect((await POST(post({ userId: ADMIN, confirmEmail: email(ADMIN) }) as never)).status).toBe(403)
      expect((await POST(post({ userId: OTHER_ADMIN, confirmEmail: email(OTHER_ADMIN) }) as never)).status).toBe(403)
      // A non-admin is unaffected.
      expect((await POST(post({ userId: PERSON, confirmEmail: email(PERSON) }) as never)).status).toBe(200)
      expect(await metrics(ADMIN)).toBe(1)
    })

    it('403 for another admin\'s account, with the right email, and nothing is touched or revoked', async () => {
      const { POST } = await import('@/app/api/admin/users/reset-data/route')
      const res = await POST(post({ userId: OTHER_ADMIN, confirmEmail: email(OTHER_ADMIN) }) as never)
      expect(res.status).toBe(403)
      expect(await metrics(OTHER_ADMIN)).toBe(1)
      expect(revoke.calls).toEqual([])
      expect(await audit('admin-reset-user-data', OTHER_ADMIN)).toHaveLength(0)
    })

    it('400 for the wrong email, and nothing is touched or revoked', async () => {
      const { POST } = await import('@/app/api/admin/users/reset-data/route')
      const res = await POST(post({ userId: PERSON, confirmEmail: 'someone@else.com' }) as never)
      expect(res.status).toBe(400)
      expect(await metrics(PERSON)).toBe(1)
      expect(revoke.calls).toEqual([])
      const { rows: [u] } = await pool.query('SELECT sessions_valid_from FROM users WHERE id = $1', [PERSON])
      expect(u.sessions_valid_from).toBeNull()
    })

    it.each([
      ['no email', { userId: PERSON }],
      ['an empty email', { userId: PERSON, confirmEmail: '' }],
      ['a body that names anything else', { userId: PERSON, confirmEmail: 'x@y.co', all: true }],
      ['no user', { confirmEmail: 'x@y.co' }],
      ['a non-string email', { userId: PERSON, confirmEmail: 5 }],
    ])('400 for %s, and nothing is touched', async (_label, body) => {
      const { POST } = await import('@/app/api/admin/users/reset-data/route')
      const res = await POST(post(body) as never)
      expect(res.status).toBe(400)
      expect(await metrics(PERSON)).toBe(1)
    })

    it('400 for an id that is not a uuid', async () => {
      const { POST } = await import('@/app/api/admin/users/reset-data/route')
      const res = await POST(post({ userId: 'not-a-uuid', confirmEmail: 'x@y.co' }) as never)
      expect(res.status).toBe(400)
    })

    it('404 for an id with no account', async () => {
      const { POST } = await import('@/app/api/admin/users/reset-data/route')
      const res = await POST(post({ userId: '00000000-0000-4000-8000-000000000999', confirmEmail: 'x@y.co' }) as never)
      expect(res.status).toBe(404)
    })

    it('401 without a session and 403 for a signed-in user who is not an admin, changing nothing', async () => {
      const { POST } = await import('@/app/api/admin/users/reset-data/route')
      session.current = null
      expect((await POST(post({ userId: PERSON, confirmEmail: email(PERSON) }) as never)).status).toBe(401)
      session.current = { user: { id: PLAIN, isAdmin: true } }   // a stale claim: the database says no
      expect((await POST(post({ userId: PERSON, confirmEmail: email(PERSON) }) as never)).status).toBe(403)
      expect(await metrics(PERSON)).toBe(1)
    })

    it('429 when the limiter says no, before anything is read or changed', async () => {
      limiter.allow = false
      const { POST } = await import('@/app/api/admin/users/reset-data/route')
      const res = await POST(post({ userId: PERSON, confirmEmail: email(PERSON) }) as never)
      expect(res.status).toBe(429)
      expect(await metrics(PERSON)).toBe(1)
    })
  })

  describe('DELETE /api/admin/users with the email typed', () => {
    it('deletes an account that holds data, revokes Oura after the commit, and records it', async () => {
      const { DELETE } = await import('@/app/api/admin/users/route')
      const res = await DELETE(del({ userId: GONE, confirmEmail: email(GONE) }) as never)
      expect(res.status).toBe(200)
      expect(await exists(GONE)).toBe(false)
      expect(revoke.calls).toEqual([GONE])
      const rows = (await pool.query(
        `SELECT * FROM agent_action_log WHERE job = 'admin-delete-account' AND parameters->>'targetUserId' = $1 AND started_at >= $2`,
        [GONE, runStart])).rows
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ actor: `admin:${ADMIN}`, outcome: 'succeeded' })
      expect(rows[0].parameters.removed.body_metrics).toBe(1)
    })

    it('400 for the wrong email, and the account and its data stay', async () => {
      const { DELETE } = await import('@/app/api/admin/users/route')
      const res = await DELETE(del({ userId: GONE, confirmEmail: email(PERSON) }) as never)
      expect(res.status).toBe(400)
      expect(await exists(GONE)).toBe(true)
      expect(await metrics(GONE)).toBe(1)
      expect(revoke.calls).toEqual([])
    })

    it('403 for another admin\'s account, with the right email, and also without one', async () => {
      const { DELETE } = await import('@/app/api/admin/users/route')
      expect((await DELETE(del({ userId: OTHER_ADMIN, confirmEmail: email(OTHER_ADMIN) }) as never)).status).toBe(403)
      expect((await DELETE(del({ userId: OTHER_ADMIN }) as never)).status).toBe(403)
      expect(await exists(OTHER_ADMIN)).toBe(true)
      expect(await metrics(OTHER_ADMIN)).toBe(1)
      expect(revoke.calls).toEqual([])
    })

    it('still refuses an admin deleting themselves (400), email or not', async () => {
      const { DELETE } = await import('@/app/api/admin/users/route')
      expect((await DELETE(del({ userId: ADMIN, confirmEmail: email(ADMIN) }) as never)).status).toBe(400)
      expect(await exists(ADMIN)).toBe(true)
    })

    it('an upper-case copy of your own id is still you: no self deletion', async () => {
      const { DELETE } = await import('@/app/api/admin/users/route')
      for (const confirmEmail of [undefined, email(ADMIN)]) {
        expect((await DELETE(del({ userId: ADMIN.toUpperCase(), confirmEmail }) as never)).status).toBe(400)
      }
      expect(await exists(ADMIN)).toBe(true)
      expect(await metrics(ADMIN)).toBe(1)
    })

    it('without the email, an account that holds data is still refused (409), as before', async () => {
      const { DELETE } = await import('@/app/api/admin/users/route')
      const res = await DELETE(del({ userId: GONE }) as never)
      expect(res.status).toBe(409)
      expect(await exists(GONE)).toBe(true)
    })

    it('400 for a body that names anything else', async () => {
      const { DELETE } = await import('@/app/api/admin/users/route')
      expect((await DELETE(del({ userId: GONE, confirmEmail: email(GONE), force: true }) as never)).status).toBe(400)
      expect(await exists(GONE)).toBe(true)
    })

    it('429 when the limiter says no, and the account stays', async () => {
      limiter.allow = false
      const { DELETE } = await import('@/app/api/admin/users/route')
      expect((await DELETE(del({ userId: GONE, confirmEmail: email(GONE) }) as never)).status).toBe(429)
      expect(await exists(GONE)).toBe(true)
    })
  })
})
