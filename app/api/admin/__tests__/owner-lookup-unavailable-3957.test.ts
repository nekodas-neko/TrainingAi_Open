import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// #3957 review: a database fault during the owner lookup answered 403 "Forbidden", so during an
// outage the owner's own tools said "only the owner can see this". It now answers 503 and returns
// no data. Real accounts in a real database; only the session is supplied, and only the owner
// lookup's `getUserById` (the call made from `resolveOwnerUserId`) rejects. `requireAdmin`'s read of
// the same row still succeeds, so each request gets past the admin check and fails on the owner.
const OWNER = '00000000-0000-4000-8000-00000395700f'
const OTHER = '00000000-0000-4000-8000-00000395701a'
const SECRET = 'owner-lookup-3957-secret'

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; isAdmin?: boolean } } }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => session.current) }))

const canRun = !!process.env.DATABASE_URL
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const routes = {
  dbQuery: async (headers: Record<string, string> = {}) => {
    const { POST } = await import('@/app/api/admin/db-query/route')
    return POST(new NextRequest('http://localhost/api/admin/db-query', {
      ...json({ sql: 'SELECT id FROM claude_ro.users' }), headers: { 'content-type': 'application/json', ...headers },
    }))
  },
  dbQuerySchema: async () => {
    const { GET } = await import('@/app/api/admin/db-query/route')
    return GET(new NextRequest('http://localhost/api/admin/db-query'))
  },
  dbSnapshot: async (headers: Record<string, string> = {}) => {
    const { GET } = await import('@/app/api/admin/db-snapshot/route')
    return GET(new NextRequest('http://localhost/api/admin/db-snapshot?tables=users', { headers }))
  },
  grantAdmin: async () => {
    const { PATCH } = await import('@/app/api/admin/users/route')
    return PATCH(new NextRequest('http://localhost/api/admin/users', { ...json({ userId: OTHER, action: 'grant-admin' }), method: 'PATCH' }))
  },
  deactivate: async () => {
    const { PATCH } = await import('@/app/api/admin/users/route')
    return PATCH(new NextRequest('http://localhost/api/admin/users', { ...json({ userId: OTHER, action: 'deactivate' }), method: 'PATCH' }))
  },
  deleteUser: async () => {
    const { DELETE } = await import('@/app/api/admin/users/route')
    return DELETE(new NextRequest('http://localhost/api/admin/users', {
      ...json({ userId: OTHER, confirmEmail: 'lookup-other-3957@example.com' }), method: 'DELETE',
    }))
  },
  resetData: async () => {
    const { POST } = await import('@/app/api/admin/users/reset-data/route')
    return POST(new NextRequest('http://localhost/api/admin/users/reset-data', {
      ...json({ userId: OTHER, confirmEmail: 'lookup-other-3957@example.com' }),
    }))
  },
}

describe.skipIf(!canRun)('a failed owner lookup answers 503, not 403, and returns nothing (#3957)', () => {
  let pool: import('pg').Pool
  let restore: (() => void) | null = null

  /** Make only `resolveOwnerUserId`'s `getUserById` reject; every other caller reads the row. */
  const failOwnerLookup = async () => {
    const { getRepository } = await import('@/lib/data')
    const repo = await getRepository()
    const real = repo.getUserById.bind(repo)
    const calls = { owner: 0 }
    const spy = vi.spyOn(repo, 'getUserById').mockImplementation(async (id: string) => {
      if (new Error().stack?.includes('resolveOwnerUserId')) {
        calls.owner++
        throw new Error('connection terminated unexpectedly')
      }
      return real(id)
    })
    restore = () => spy.mockRestore()
    return calls
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[OWNER, OTHER]])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active) VALUES
         ($1, 'lookup-owner-3957@example.com', 'x', 'Australia/Brisbane', true,  true),
         ($2, 'lookup-other-3957@example.com', 'x', 'Australia/Brisbane', false, true)`,
      [OWNER, OTHER])
  })

  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('CLAUDE_RO_OWNER_USER_ID', OWNER)
    vi.stubEnv('ADMIN_EXPORT_USER_ID', OWNER)
    vi.stubEnv('CLAUDE_DB_QUERY_SECRET', SECRET)
    vi.stubEnv('ADMIN_SNAPSHOT_SECRET', SECRET)
    vi.stubEnv('CLAUDE_DB_READONLY_URL', process.env.DATABASE_URL!)
    await pool.query('UPDATE users SET is_admin = (id = $2), is_active = true WHERE id = ANY($1::uuid[])', [[OWNER, OTHER], OWNER])
    const { __resetReadonlyPoolForTests } = await import('@/lib/data/postgres/readonly-client')
    __resetReadonlyPoolForTests()
    session.current = { user: { id: OWNER, isAdmin: true } }
  })

  afterEach(() => {
    restore?.()
    restore = null
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[OWNER, OTHER]])
  })

  it.each(Object.keys(routes) as (keyof typeof routes)[])('%s: the owner session gets 503 with no data', async (name) => {
    const calls = await failOwnerLookup()
    const res = await routes[name]()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toMatch(/^Service unavailable/)
    expect(Object.keys(body)).toEqual(['error'])
    expect(calls.owner).toBeGreaterThan(0)
  })

  it('db-query and db-snapshot by the agent token also answer 503, and run nothing', async () => {
    await failOwnerLookup()
    const bearer = { authorization: `Bearer ${SECRET}` }
    for (const res of [await routes.dbQuery(bearer), await routes.dbSnapshot(bearer)]) {
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.error).toMatch(/^Service unavailable; nothing was (run|read)$/)
      expect(Object.keys(body)).toEqual(['error'])
    }
  })

  it('nothing owner-gated is written during the fault: the other account is still a plain, active user', async () => {
    await failOwnerLookup()
    await routes.grantAdmin()
    await routes.deactivate()
    await routes.deleteUser()
    await routes.resetData()
    const { rows } = await pool.query('SELECT is_admin, is_active FROM users WHERE id = $1', [OTHER])
    expect(rows).toEqual([{ is_admin: false, is_active: true }])
  })

  it('once the lookup answers, the same owner session gets through (the grant succeeds)', async () => {
    const res = await routes.grantAdmin()
    expect(res.status).toBe(200)
    const { rows } = await pool.query('SELECT is_admin FROM users WHERE id = $1', [OTHER])
    expect(rows).toEqual([{ is_admin: true }])
  })

  it('an unconfigured owner is not a fault: the owner-only session gate stays 403', async () => {
    for (const k of ['CLAUDE_RO_OWNER_USER_ID', 'ADMIN_EXPORT_USER_ID', 'WEBHOOK_USER_ID']) vi.stubEnv(k, '')
    for (const res of [await routes.dbQuery(), await routes.dbSnapshot(), await routes.grantAdmin()]) {
      expect(res.status).toBe(403)
    }
  })
})
