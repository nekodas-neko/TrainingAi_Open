import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { sql } from 'drizzle-orm'

// #3673 review round, item 4, at the route level: the redecode route (the stored error, the dump
// answer, the job poll) and the db-snapshot audit row. A REAL Drizzle error from a real refused
// query is what the stubbed work throws, and the rows are read back. Values are made up.
const OWNER = '00000000-0000-4000-8000-000000367302'
const SECRET = 'routes-3673-secret'
const MULTI = 'CANARY-first-line\n    at the gym\nCANARY-third-line'
const WORDS = ['CANARY', 'at the gym']

const session = vi.hoisted(() => ({ current: null as null | { user: { id: string; isAdmin?: boolean } } }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => session.current) }))
const work = vi.hoisted(() => ({ run: null as null | (() => Promise<unknown>) }))
vi.mock('@/lib/oura-ble/rollup-worker', () => ({
  runRedecodeOffLoop: vi.fn(async () => work.run!()),
  runStressBackfillOffLoop: vi.fn(async () => work.run!()),
}))

const canRun = !!process.env.DATABASE_URL
const clean = (v: unknown) => {
  const t = typeof v === 'string' ? v : JSON.stringify(v)
  expect(t).toBeTruthy()
  for (const w of WORDS) expect(t, w).not.toContain(w)
}

describe.skipIf(!canRun)('route-level error text is scrubbed (#3673)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  const realError = async (): Promise<Error> => {
    try { await db.execute(sql`select ${MULTI}::uuid`); throw new Error('expected a failure') } catch (e) { return e as Error }
  }

  beforeAll(async () => {
    const c = await import('@/lib/data/postgres/client')
    pool = c.getPool(); db = c.getDb()
    await pool.query('DELETE FROM users WHERE id = $1', [OWNER])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active) VALUES ($1,'routes-3673@example.com','x','Australia/Brisbane',true,true)`, [OWNER])
  })
  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('CLAUDE_RO_OWNER_USER_ID', OWNER)
    vi.stubEnv('ADMIN_EXPORT_USER_ID', OWNER)
    vi.stubEnv('ADMIN_SNAPSHOT_SECRET', SECRET)
    vi.stubEnv('CLAUDE_DB_READONLY_URL', process.env.DATABASE_URL!)
    await pool.query('DELETE FROM oura_redecode_jobs WHERE user_id = $1', [OWNER])
    const { __resetReadonlyPoolForTests } = await import('@/lib/data/postgres/readonly-client')
    __resetReadonlyPoolForTests()
    ;(await import('@/lib/rate-limit'))._resetRateLimitL1()
    session.current = { user: { id: OWNER, isAdmin: true } }
  })
  afterEach(() => { vi.restoreAllMocks() })
  afterAll(async () => {
    vi.unstubAllEnvs()
    await pool.query(`DELETE FROM db_query_log WHERE sql_text LIKE 'SNAPSHOT tables=%' AND error LIKE 'invalid input syntax for type uuid%'`)
    await pool.query('DELETE FROM users WHERE id = $1', [OWNER])
  })

  const post = async (qs: string) => {
    const { POST } = await import('@/app/api/oura-ble/samples/redecode/route')
    return POST(new Request(`http://localhost/api/oura-ble/samples/redecode?${qs}`, { method: 'POST' }))
  }
  const settled = async () => {
    for (let i = 0; i < 100; i++) {
      const { rows: [row] } = await pool.query('SELECT result, error, finished_at FROM oura_redecode_jobs WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [OWNER])
      if (row?.finished_at) return row
      await new Promise(r => setTimeout(r, 50))
    }
    throw new Error('job never finished')
  }

  it('redecode route: a throw that reaches the .catch is stored scrubbed', async () => {
    const err = await realError()
    work.run = async () => { throw err }
    const res = await post('async=1')
    expect(res.status).toBe(200)
    const row = await settled()
    clean(row.error)
    expect(row.error).toContain('Failed query:')
  })

  it('redecode route: phases that carry raw error text are stored scrubbed, and the poll answer is clean', async () => {
    const err = await realError()
    const pg = (err as { cause: Error }).cause
    work.run = async () => ({ redecoded: null, redecodeError: err.message, aggregated: null, aggregateError: `${pg.message}` })
    const res = await post('async=1')
    const { jobId } = await res.json()
    const row = await settled()
    clean(row.result)
    const { GET } = await import('@/app/api/oura-ble/samples/redecode/route')
    const answer = await (await GET(new Request(`http://localhost/api/oura-ble/samples/redecode?jobId=${jobId}`))).json()
    clean(answer)
    expect(answer.job.status).toBe('failed')
  })

  it('redecode route: the dump answer', async () => {
    const err = await realError()
    work.run = async () => ({ aggregated: null, aggregateError: `${err.message}` })
    const res = await post('dump=1')
    const body = await res.json()
    expect(body.aggregateError).toBeTruthy()
    clean(body)
  })

  it('db-snapshot: the audit row in db_query_log', async () => {
    const err = await realError()
    const { getReadonlyPool } = await import('@/lib/data/postgres/readonly-client')
    vi.spyOn(getReadonlyPool(), 'query').mockRejectedValue((err as { cause: Error }).cause as never)
    const { GET } = await import('@/app/api/admin/db-snapshot/route')
    const res = await GET(new NextRequest('http://localhost/api/admin/db-snapshot?tables=users', { headers: { authorization: `Bearer ${SECRET}` } }))
    expect(res.status).toBe(500)
    clean(await res.json())
    const { rows } = await pool.query(`SELECT error FROM db_query_log WHERE sql_text LIKE 'SNAPSHOT tables=%' AND ok = false AND error LIKE 'invalid input syntax for type uuid%' ORDER BY created_at DESC LIMIT 1`)
    expect(rows).toHaveLength(1)
    clean(rows[0].error)
    expect(rows[0].error).toBe('invalid input syntax for type uuid: "…"')
  })
})
