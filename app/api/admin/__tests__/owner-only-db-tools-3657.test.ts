import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// #3657: an admin session reads through `/api/admin/db-query` and `/api/admin/db-snapshot` only when
// it is the owner's. Real accounts in a real database: only the session is supplied (`@/auth`), so
// `requireAdmin` and the owner check read the seeded rows. A second, fully active admin is refused
// with the same 403 body as a non-admin.
const OWNER = '00000000-0000-4000-8000-00000365700f'
const ADMIN = '00000000-0000-4000-8000-00000365701a'
const PLAIN = '00000000-0000-4000-8000-00000365702b'

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; isAdmin?: boolean } } }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => session.current) }))
const asUser = (id: string) => { session.current = { user: { id, isAdmin: true } } }

const canRun = !!process.env.DATABASE_URL

const query = async (sql: string) => {
  const { POST } = await import('@/app/api/admin/db-query/route')
  return POST(new NextRequest('http://localhost/api/admin/db-query', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql }),
  }))
}
const snapshot = async (search = '?bulk=all') => {
  const { GET } = await import('@/app/api/admin/db-snapshot/route')
  return GET(new NextRequest(`http://localhost/api/admin/db-snapshot${search}`))
}
/** The read-only URL with the connection's own default owner scope set to `id`, standing in for a
 *  `claude_readonly` role whose `app.claude_ro_owner` default names someone else. */
const readonlyUrlDefaultingTo = (id: string) => {
  const u = new URL(process.env.DATABASE_URL!)
  u.searchParams.set('options', `-c app.claude_ro_owner=${id}`)
  return u.toString()
}
const schema = async () => {
  const { GET } = await import('@/app/api/admin/db-query/route')
  return GET(new NextRequest('http://localhost/api/admin/db-query'))
}

describe.skipIf(!canRun)('db-query and db-snapshot: an admin session must be the owner (#3657)', () => {
  let pool: import('pg').Pool

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[OWNER, ADMIN, PLAIN]])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active) VALUES
         ($1, 'tools-owner-3657@example.com', 'x', 'Australia/Brisbane', true,  true),
         ($2, 'tools-admin-3657@example.com', 'x', 'Australia/Brisbane', true,  true),
         ($3, 'tools-plain-3657@example.com', 'x', 'Australia/Brisbane', false, true)`,
      [OWNER, ADMIN, PLAIN])
  })

  beforeEach(async () => {
    vi.stubEnv('CLAUDE_RO_OWNER_USER_ID', OWNER)
    vi.stubEnv('CLAUDE_DB_READONLY_URL', '')
    await pool.query('UPDATE users SET is_admin = (id <> $2), is_active = true WHERE id = ANY($1::uuid[])', [[OWNER, ADMIN, PLAIN], PLAIN])
    const { __resetReadonlyPoolForTests } = await import('@/lib/data/postgres/readonly-client')
    __resetReadonlyPoolForTests()
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[OWNER, ADMIN, PLAIN]])
  })

  it('a second admin is refused by db-query, db-query\'s schema read and db-snapshot, with the guards\' 403 body', async () => {
    asUser(ADMIN)
    for (const res of [await query('SELECT 1 AS n'), await schema(), await snapshot()]) {
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'Forbidden' })
    }
  })

  it('a non-admin gets the same 403, and no session a 401', async () => {
    asUser(PLAIN)
    expect((await query('SELECT 1 AS n')).status).toBe(403)
    expect((await snapshot()).status).toBe(403)
    session.current = null
    expect((await query('SELECT 1 AS n')).status).toBe(401)
    expect((await snapshot()).status).toBe(401)
  })

  it('the owner\'s session runs a query: 200 with the rows', async () => {
    // The local superuser stands in for `claude_readonly`: this is about who gets through, and the
    // role's own guarantees are tested in `claude-ro-readonly-role.test.ts`.
    vi.stubEnv('CLAUDE_DB_READONLY_URL', process.env.DATABASE_URL!)
    asUser(OWNER)
    const res = await query('SELECT 1 AS n')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ rows: [{ n: 1 }] })
  })

  it('the owner\'s session gets past authorisation on db-snapshot (it stops at the unconfigured read-only connection)', async () => {
    asUser(OWNER)
    const res = await snapshot()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Read-only database access is not configured' })
  })

  it('the owner\'s row is re-read on every call: an owner demoted from admin is refused', async () => {
    await pool.query('UPDATE users SET is_admin = false WHERE id = $1', [OWNER])
    asUser(OWNER)
    expect((await query('SELECT 1 AS n')).status).toBe(403)
    expect((await snapshot()).status).toBe(403)
  })

  it('fails closed when the owner cannot be resolved: even the configured account is refused', async () => {
    for (const k of ['CLAUDE_RO_OWNER_USER_ID', 'ADMIN_EXPORT_USER_ID', 'WEBHOOK_USER_ID']) vi.stubEnv(k, '')
    asUser(OWNER)
    expect((await query('SELECT 1 AS n')).status).toBe(403)
    expect((await snapshot()).status).toBe(403)
  })

  it('an owner setting naming the second admin makes it the owner, and the first admin is refused', async () => {
    vi.stubEnv('CLAUDE_RO_OWNER_USER_ID', ADMIN)
    asUser(OWNER)
    expect((await snapshot()).status).toBe(403)
    asUser(ADMIN)
    expect((await snapshot()).status).toBe(503)
  })

  // #3949 review N7: the rows a query reads are scoped to the owner the check resolved, set on the
  // query itself, not to the read-only connection's default. Here the connection defaults to the
  // second admin, the settings name the owner, and the owner's session reads as the owner.
  it('db-query reads as the resolved owner even when the connection defaults to someone else', async () => {
    vi.stubEnv('CLAUDE_DB_READONLY_URL', readonlyUrlDefaultingTo(ADMIN))
    asUser(OWNER)
    const res = await query(`SELECT current_setting('app.claude_ro_owner', true) AS owner, (SELECT count(*)::int FROM claude_ro.users) AS n, (SELECT id::text FROM claude_ro.users) AS id`)
    expect(res.status).toBe(200)
    expect((await res.json()).rows).toEqual([{ owner: OWNER, n: 1, id: OWNER }])
  })

  it('db-snapshot streams the resolved owner\'s rows even when the connection defaults to someone else', async () => {
    vi.stubEnv('CLAUDE_DB_READONLY_URL', readonlyUrlDefaultingTo(ADMIN))
    asUser(OWNER)
    // Two rows for the owner and none for the second admin, so a count under the wrong scope reads 0.
    await pool.query('DELETE FROM body_metrics WHERE user_id = ANY($1::uuid[])', [[OWNER, ADMIN]])
    await pool.query(`INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, '2026-01-01', 70), ($1, '2026-01-02', 70)`, [OWNER])
    try {
      const res = await snapshot('?tables=users,body_metrics')
      expect(res.status).toBe(200)
      const lines = (await res.text()).trim().split('\n').map(l => JSON.parse(l))
      expect(lines[0]).toMatchObject({ manifest: true, rowCounts: { users: 1, body_metrics: 2 } })
      expect(lines.filter(l => l.table === 'users').map(l => l.row.id)).toEqual([OWNER])
      expect(lines.filter(l => l.table === 'body_metrics').map(l => l.row.user_id)).toEqual([OWNER, OWNER])
    } finally {
      await pool.query('DELETE FROM body_metrics WHERE user_id = ANY($1::uuid[])', [[OWNER, ADMIN]])
    }
  })

  it('the scope is the owner the check resolved, else resolved the same way, and none when unresolvable', async () => {
    const { scopeOwnerFor } = await import('@/lib/admin/claude-token-auth')
    for (const k of ['CLAUDE_RO_OWNER_USER_ID', 'ADMIN_EXPORT_USER_ID', 'WEBHOOK_USER_ID']) vi.stubEnv(k, '')
    expect(await scopeOwnerFor({})).toMatchObject({ ok: false, status: 503, reason: 'unresolved' })
    vi.stubEnv('CLAUDE_RO_OWNER_USER_ID', OWNER)
    expect(await scopeOwnerFor({})).toEqual({ ok: true, ownerId: OWNER })
    expect(await scopeOwnerFor({ ownerId: OWNER })).toEqual({ ok: true, ownerId: OWNER })
  })
})
