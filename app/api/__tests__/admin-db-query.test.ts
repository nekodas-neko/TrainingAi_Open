// Auth and bounds for the read-only query endpoint. The read-only GUARANTEE itself is a Postgres
// grant and is tested against a real database in
// lib/data/postgres/__tests__/claude-ro-readonly-role.test.ts — these cover the layer above it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const authMock = vi.fn(async () => null as unknown)
vi.mock('@/auth', () => ({ auth: () => authMock() }))

const getUserById = vi.fn(async () => ({ id: 'admin-1', isAdmin: true }))
vi.mock('@/lib/data', () => ({ getRepository: vi.fn(async () => ({ getUserById })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => true) }))

const auditInsert = vi.fn(async () => ({ rows: [] }))
vi.mock('@/lib/data/postgres/client', () => ({ getPool: () => ({ query: auditInsert }) }))

const roQuery = vi.fn(async () => ({ rows: [{ n: 1 }], fields: [{ name: 'n' }] }) as { rows: unknown[]; fields: { name: string }[] })
let configured = true
vi.mock('@/lib/data/postgres/readonly-client', () => ({
  isReadonlyDbConfigured: () => configured,
  getReadonlyPool: () => ({ query: roQuery }),
  describeReadonlyConnection: () => ({ configured, user: 'claude_readonly', host: 'db', port: '5432', database: 'railway' }),
}))

import { POST, GET } from '@/app/api/admin/db-query/route'
import { NextRequest } from 'next/server'

const SECRET = 'db-query-secret-value-here'
const post = (sql: unknown, headers: Record<string, string> = {}) =>
  POST(new NextRequest(new Request('http://x/api/admin/db-query', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ sql }),
  })))
const withToken = (t: string) => ({ authorization: `Bearer ${t}` })

beforeEach(() => {
  configured = true
  authMock.mockReset().mockResolvedValue(null)
  getUserById.mockReset().mockResolvedValue({ id: 'admin-1', isAdmin: true })
  roQuery.mockReset().mockResolvedValue({ rows: [{ n: 1 }], fields: [{ name: 'n' }] })
  auditInsert.mockClear()
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
    getUserById.mockResolvedValue({ id: 'admin-1', isAdmin: false })
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
