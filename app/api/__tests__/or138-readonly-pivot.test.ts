// OR-138 — the triaging agent may read the data of the user who filed a feedback report.
//
// The owner asked for this and the widening is recorded on the entry. It takes the endpoint from
// "one user, structurally" to "whichever user the caller names", so the three properties that keep
// it honest are pinned here: the pivot is gated on having filed feedback, it is scoped with
// SET LOCAL inside a transaction so it cannot outlive the request, and it is recorded in the audit
// log. Absent `userId`, the path is the one that shipped before.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const authMock = vi.fn(async () => null as unknown)
vi.mock('@/auth', () => ({ auth: () => authMock() }))
vi.mock('@/lib/data', () => ({ getRepository: vi.fn(async () => ({ getUserById: async () => ({ id: 'a', isAdmin: true }) })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => true) }))

/** The app pool answers the feedback gate AND takes the audit insert. */
const appQuery = vi.fn(async (sql: string) => (
  /feedback_submissions/.test(sql) ? { rows: hasFeedback ? [{ '?column?': 1 }] : [] } : { rows: [] }
))
let hasFeedback = true
vi.mock('@/lib/data/postgres/client', () => ({ getPool: () => ({ query: appQuery }) }))

const clientQuery = vi.fn(async () => ({ rows: [{ n: 1 }], fields: [{ name: 'n' }] }))
const release = vi.fn()
const poolQuery = vi.fn(async () => ({ rows: [{ n: 1 }], fields: [{ name: 'n' }] }))
vi.mock('@/lib/data/postgres/readonly-client', () => ({
  isReadonlyDbConfigured: () => true,
  getReadonlyPool: () => ({ query: poolQuery, connect: async () => ({ query: clientQuery, release }) }),
  describeReadonlyConnection: () => ({ configured: true }),
}))

import { POST } from '@/app/api/admin/db-query/route'
import { NextRequest } from 'next/server'

const SECRET = 'db-query-secret-value-here'
const OTHER = '11111111-1111-1111-1111-111111111111'
const post = (body: Record<string, unknown>) =>
  POST(new NextRequest(new Request('http://x/api/admin/db-query', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(body),
  })))

beforeEach(() => {
  hasFeedback = true
  appQuery.mockClear(); clientQuery.mockClear(); poolQuery.mockClear(); release.mockClear()
  authMock.mockReset().mockResolvedValue(null)
  process.env.CLAUDE_DB_QUERY_SECRET = SECRET
  process.env.ADMIN_EXPORT_USER_ID = 'a'
})

describe('OR-138 — the read-only pivot', () => {
  it('leaves the shipped path untouched when no userId is sent', async () => {
    const res = await post({ sql: 'SELECT 1' })
    expect(res.status).toBe(200)
    // The pooled convenience query, NOT a checked-out client — so no transaction, no SET.
    expect(poolQuery).toHaveBeenCalledTimes(1)
    expect(clientQuery).not.toHaveBeenCalled()
  })

  it('scopes with SET LOCAL inside a transaction, and releases the client', async () => {
    const res = await post({ sql: 'SELECT 1', userId: OTHER })
    expect(res.status).toBe(200)

    const issued = clientQuery.mock.calls.map(c => String(c[0]))
    expect(issued[0]).toBe('BEGIN')                       // SET LOCAL outside one silently does nothing
    expect(issued[1]).toContain('SET LOCAL app.claude_ro_owner')
    expect(issued[1]).toContain(OTHER)
    expect(issued.at(-1)).toBe('COMMIT')
    expect(release).toHaveBeenCalledTimes(1)              // or the pool leaks a connection per pivot
  })

  it('never issues a bare SET, which would outlive the request on a pooled connection', async () => {
    await post({ sql: 'SELECT 1', userId: OTHER })
    for (const call of clientQuery.mock.calls.map(c => String(c[0]))) {
      if (call.includes('app.claude_ro_owner')) expect(call).toMatch(/^SET LOCAL\b/)
    }
  })

  it('refuses a user who has filed no feedback', async () => {
    hasFeedback = false
    const res = await post({ sql: 'SELECT 1', userId: OTHER })
    expect(res.status).toBe(403)
    expect(clientQuery).not.toHaveBeenCalled()            // refused BEFORE any scoped read
  })

  it('refuses anything that is not a uuid, because the value is interpolated', async () => {
    for (const bad of ["'; DROP TABLE users; --", 'not-a-uuid', 42, '']) {
      const res = await post({ sql: 'SELECT 1', userId: bad })
      expect(res.status, `accepted ${String(bad)}`).toBe(400)
    }
    expect(clientQuery).not.toHaveBeenCalled()
  })

  it('records the pivot in the audit row, so a cross-user read is attributable', async () => {
    await post({ sql: 'SELECT 1', userId: OTHER })
    const audit = appQuery.mock.calls.find(c => /INSERT INTO db_query_log/.test(String(c[0])))
    expect(audit, 'no audit row was written').toBeTruthy()
    expect(String((audit![1] as unknown[])[0])).toContain(OTHER)
  })

  it('writes no pivot marker when there was no pivot', async () => {
    await post({ sql: 'SELECT 1' })
    const audit = appQuery.mock.calls.find(c => /INSERT INTO db_query_log/.test(String(c[0])))
    expect(String((audit![1] as unknown[])[0])).not.toContain('claude_ro pivot')
  })
})
