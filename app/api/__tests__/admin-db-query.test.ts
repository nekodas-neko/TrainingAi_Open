// Auth and bounds for the read-only query endpoint. The read-only GUARANTEE itself is a Postgres
// grant and is tested against a real database in
// lib/data/postgres/__tests__/claude-ro-readonly-role.test.ts — these cover the layer above it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const authMock = vi.fn(async () => null as unknown)
vi.mock('@/auth', () => ({ auth: () => authMock() }))

const getUserById = vi.fn(async () => ({ id: 'admin-1', isActive: true, isAdmin: true }))
vi.mock('@/lib/data', () => ({ getRepository: vi.fn(async () => ({ getUserById })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => true) }))

// Same reason as `roQuery` below: the cases read `calls[0][1]` (the bind parameters), which is a
// type error while the mock declares no arguments.
// The same pool also answers the scope check (`feedback_submissions`, #2119), so it routes on the
// statement: a SELECT is the check, anything else is an audit insert.
const FEEDBACK_USER = '4a6f1c2e-8b3d-4e5f-9a7b-1c2d3e4f5a6b'
let feedbackLookupFails = false
const defaultAudit = async (sql?: string, params?: unknown[]) => {
  if (sql?.includes('feedback_submissions')) {
    if (feedbackLookupFails) throw new Error('db down')
    return { rows: params?.[0] === FEEDBACK_USER ? [{ '?column?': 1 }] : [] }
  }
  // A scoped read inserts its audit row first and takes the id back to finish it (RETURNING id).
  return { rows: sql?.includes('RETURNING id') ? [{ id: 'log-1' }] : [] }
}
const auditInsert = vi.fn(defaultAudit)
vi.mock('@/lib/data/postgres/client', () => ({ getPool: () => ({ query: auditInsert }) }))

// Typed with the sql it receives (RV-190). It was declared taking no arguments, so every
// `roQuery.mock.calls[0][0]` below was a type error against an empty tuple — three of them, carried
// in the test-typecheck baseline. Naming the parameter fixes those as well as the call through
// `runScoped`.
const roQuery = vi.fn(async (_sql?: string, _opts?: { ownerId?: string }) => ({ rows: [{ n: 1 }], fields: [{ name: 'n' }] }) as { rows: unknown[]; fields: { name: string }[] })
let configured = true
vi.mock('@/lib/data/postgres/readonly-client', () => ({
  isReadonlyDbConfigured: () => configured,
  // RV-190: the pool deliberately has NO `query`. Every read on it goes through `runScoped`, which
  // reasserts the role's protections per query — and a route that went back to `pool.query` would
  // fail here with "query is not a function" rather than passing quietly. The wrapper's own
  // behaviour is exercised against a real database in `claude-ro-readonly-role.test.ts`; these
  // cases are about the route's logic, so it is a spy.
  getReadonlyPool: () => ({}),
  runScoped: (_pool: unknown, sql: string, opts?: { ownerId?: string }) => roQuery(sql, opts),
  describeReadonlyConnection: () => ({ configured, user: 'claude_readonly', host: 'db', port: '5432', database: 'railway' }),
}))

import { POST, GET } from '@/app/api/admin/db-query/route'
import { NextRequest } from 'next/server'

const SECRET = 'db-query-secret-value-here'
const post = (sql: unknown, headers: Record<string, string> = {}, userId?: unknown) =>
  POST(new NextRequest(new Request('http://x/api/admin/db-query', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(userId === undefined ? { sql } : { sql, userId }),
  })))
const withToken = (t: string) => ({ authorization: `Bearer ${t}` })

beforeEach(() => {
  configured = true
  authMock.mockReset().mockResolvedValue(null)
  getUserById.mockReset().mockResolvedValue({ id: 'admin-1', isActive: true, isAdmin: true })
  roQuery.mockReset().mockResolvedValue({ rows: [{ n: 1 }], fields: [{ name: 'n' }] })
  auditInsert.mockReset().mockImplementation(defaultAudit)
  feedbackLookupFails = false
  process.env.CLAUDE_DB_QUERY_SECRET = SECRET
  process.env.ADMIN_EXPORT_USER_ID = 'admin-1'
})
afterEach(() => {
  delete process.env.CLAUDE_DB_QUERY_SECRET
  delete process.env.ADMIN_EXPORT_USER_ID
})

describe('POST /api/admin/db-query — auth', () => {
  it('401s with no session and no token', async () => {
    expect((await post('SELECT 1')).status).toBe(401)
  })

  it('accepts a correct bearer token', async () => {
    expect((await post('SELECT 1', withToken(SECRET))).status).toBe(200)
  })

  it('401s a wrong token of the same length', async () => {
    expect((await post('SELECT 1', withToken('x'.repeat(SECRET.length)))).status).toBe(401)
  })

  it('fails CLOSED when CLAUDE_DB_QUERY_SECRET is unset', async () => {
    delete process.env.CLAUDE_DB_QUERY_SECRET
    expect((await post('SELECT 1', withToken(SECRET))).status).toBe(401)
  })

  it('403s when the token resolves to a non-admin', async () => {
    getUserById.mockResolvedValue({ id: 'admin-1', isActive: true, isAdmin: false })
    expect((await post('SELECT 1', withToken(SECRET))).status).toBe(403)
  })

  it('503s — never 200 — when no read-only connection is configured', async () => {
    configured = false
    const res = await post('SELECT 1', withToken(SECRET))
    expect(res.status).toBe(503)
    expect(roQuery).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/db-query — bounds', () => {
  it('rejects a non-string / empty sql body', async () => {
    expect((await post(42, withToken(SECRET))).status).toBe(400)
    expect((await post('   ', withToken(SECRET))).status).toBe(400)
  })

  it('rejects multiple statements so one audit row means one query', async () => {
    const res = await post('SELECT 1; DROP TABLE users', withToken(SECRET))
    expect(res.status).toBe(400)
    expect(roQuery).not.toHaveBeenCalled()
  })

  it('tolerates a single trailing semicolon', async () => {
    expect((await post('SELECT 1;', withToken(SECRET))).status).toBe(200)
  })

  it('wraps the query in a row-capped subquery', async () => {
    await post('SELECT * FROM users', withToken(SECRET))
    const sent = roQuery.mock.calls[0][0]
    expect(sent).toContain('SELECT * FROM (SELECT * FROM users) _q LIMIT 1001')
  })

  it('flags truncation instead of silently returning a capped set', async () => {
    roQuery.mockResolvedValue({ rows: Array.from({ length: 1001 }, (_, i) => ({ i })), fields: [] })
    const body = await (await post('SELECT * FROM oura_heartrate', withToken(SECRET))).json()
    expect(body.rowCount).toBe(1000)
    expect(body.truncated).toBe(true)
  })

  it('surfaces the database error text rather than swallowing it', async () => {
    roQuery.mockRejectedValue(new Error('permission denied for table users'))
    const res = await post('SELECT * FROM public.users', withToken(SECRET))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('permission denied')
  })
})

describe('POST /api/admin/db-query — audit log', () => {
  it('writes one row on success', async () => {
    await post('SELECT 1', withToken(SECRET))
    expect(auditInsert).toHaveBeenCalledTimes(1)
    expect(auditInsert.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['SELECT 1', true]),
    )
  })

  it('writes one row on failure too', async () => {
    roQuery.mockRejectedValue(new Error('boom'))
    await post('SELECT bad', withToken(SECRET))
    expect(auditInsert).toHaveBeenCalledTimes(1)
    expect(auditInsert.mock.calls[0][1]).toEqual(expect.arrayContaining(['boom', false]))
  })

  it('still serves the result when the audit write fails', async () => {
    auditInsert.mockRejectedValueOnce(new Error('log table missing'))
    expect((await post('SELECT 1', withToken(SECRET))).status).toBe(200)
  })
})

describe('POST /api/admin/db-query — scoped user (#2119)', () => {
  const auditRows = () => auditInsert.mock.calls.filter(c => String(c[0]).includes('INSERT INTO db_query_log'))
  // The scoped pre-insert binds (sql, ip, user); the owner/refusal insert binds eight values, user last.
  const scopedUserOf = (row: unknown[]) => (row[1] as unknown[])[row[1]!.length === 3 ? 2 : 7]

  it('an owner query is unchanged: no scope is passed and none is logged', async () => {
    expect((await post('SELECT 1', withToken(SECRET))).status).toBe(200)
    expect(roQuery.mock.calls[0][1]?.ownerId).toBeUndefined()
    expect(auditInsert.mock.calls.some(c => String(c[0]).includes('feedback_submissions'))).toBe(false)
    expect(auditRows()[0][1]![7]).toBeNull()
  })

  it('runs as the named user when that user has filed feedback, and logs who', async () => {
    const res = await post('SELECT 1', withToken(SECRET), FEEDBACK_USER)
    expect(res.status).toBe(200)
    expect(roQuery.mock.calls[0][1]).toEqual({ ownerId: FEEDBACK_USER })
    expect(scopedUserOf(auditRows()[0])).toBe(FEEDBACK_USER)
  })

  it('refuses a user with no feedback row, with the not-found body, and runs nothing', async () => {
    const res = await post('SELECT 1', withToken(SECRET), '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(roQuery).not.toHaveBeenCalled()
  })

  it.each([
    ['not a uuid', 'abc'],
    ['an injection attempt', `${FEEDBACK_USER}'; DROP TABLE users; --`],
    ['a number', 7],
    ['an object', { id: FEEDBACK_USER }],
    ['an empty string', ''],
  ])('refuses %s with the same body, and never falls back to the owner scope', async (_label, bad) => {
    const res = await post('SELECT 1', withToken(SECRET), bad)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(roQuery).not.toHaveBeenCalled()
  })

  it('refuses an explicit null like any other bad scope: only an absent userId means the owner', async () => {
    const res = await post('SELECT 1', withToken(SECRET), null)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(roQuery).not.toHaveBeenCalled()
  })

  it('writes the audit row BEFORE a scoped query runs', async () => {
    let auditedBeforeRun = false
    roQuery.mockImplementation(async () => {
      auditedBeforeRun = auditRows().length === 1
      return { rows: [{ n: 1 }], fields: [{ name: 'n' }] }
    })
    expect((await post('SELECT 1', withToken(SECRET), FEEDBACK_USER)).status).toBe(200)
    expect(auditedBeforeRun).toBe(true)
  })

  it('returns 503 and runs nothing when a scoped read cannot be audited', async () => {
    auditInsert.mockImplementation(async (sql?: string) => {
      if (sql?.includes('feedback_submissions')) return { rows: [{ '?column?': 1 }] }
      throw new Error('log table missing')
    })
    const res = await post('SELECT 1', withToken(SECRET), FEEDBACK_USER)
    expect(res.status).toBe(503)
    expect(roQuery).not.toHaveBeenCalled()
  })

  it('never looks up feedback for an unauthenticated caller', async () => {
    const res = await post('SELECT 1', {}, FEEDBACK_USER)
    expect(res.status).toBe(401)
    expect(auditInsert).not.toHaveBeenCalled()
  })

  it('finishes the scoped row with the outcome instead of adding a second one', async () => {
    await post('SELECT 1', withToken(SECRET), FEEDBACK_USER)
    expect(auditRows()).toHaveLength(1)
    const update = auditInsert.mock.calls.find(c => String(c[0]).startsWith('UPDATE db_query_log'))
    expect(update?.[1]).toEqual(['log-1', 1, expect.any(Number), false, true, null])
  })

  it('fails closed when the feedback lookup errors: nothing runs', async () => {
    feedbackLookupFails = true
    const res = await post('SELECT 1', withToken(SECRET), FEEDBACK_USER)
    expect(res.status).toBe(503)
    expect(roQuery).not.toHaveBeenCalled()
  })

  it('records a refused attempt without a scoped_user_id, since no data was read', async () => {
    await post('SELECT 1', withToken(SECRET), '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d')
    expect(auditRows()).toHaveLength(1)
    expect(auditRows()[0][1]).toEqual(expect.arrayContaining([false, expect.stringContaining('scope refused')]))
    expect(auditRows()[0][1]![7]).toBeNull()
  })

  it('logs the scope on a failed scoped query as well', async () => {
    roQuery.mockRejectedValue(new Error('boom'))
    await post('SELECT bad', withToken(SECRET), FEEDBACK_USER)
    expect(scopedUserOf(auditRows()[0])).toBe(FEEDBACK_USER)
  })

  it('does not let GET take a scope', async () => {
    const res = await GET(new NextRequest(new Request(`http://x/api/admin/db-query?userId=${FEEDBACK_USER}`, { headers: withToken(SECRET) })))
    expect(res.status).toBe(200)
    expect(roQuery.mock.calls[0][1]).toBeUndefined()
  })
})

describe('GET /api/admin/db-query — schema discovery', () => {
  it('groups claude_ro columns by view', async () => {
    roQuery.mockResolvedValue({
      rows: [
        { table_name: 'users', column_name: 'id', data_type: 'uuid' },
        { table_name: 'users', column_name: 'email', data_type: 'text' },
        { table_name: 'sleep_sessions', column_name: 'id', data_type: 'uuid' },
      ],
      fields: [],
    })
    const res = await GET(new NextRequest(new Request('http://x/api/admin/db-query', {
      headers: withToken(SECRET),
    })))
    const body = await res.json()
    expect(body.viewCount).toBe(2)
    expect(body.views.users).toHaveLength(2)
  })

  it('requires auth', async () => {
    const res = await GET(new NextRequest(new Request('http://x/api/admin/db-query')))
    expect(res.status).toBe(401)
  })
})
