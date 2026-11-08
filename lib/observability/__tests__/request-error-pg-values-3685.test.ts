// #3685, end to end: real Postgres violations, raised by the local dev database, recorded through
// `recordRequestError` (the `onRequestError` path) into the real `error_events` table. Proves no
// echoed row value lands in `message` or `stack`, and that the diagnosis does.
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { recordRequestError, resetRequestErrorDedupe } from '@/lib/observability/request-error'

const canRun = !!process.env.DATABASE_URL
const SECRET = 'a3685@example.com'

describe.skipIf(!canRun)('recordRequestError stores no value Postgres echoes', () => {
  let pool: import('pg').Pool
  let client: import('pg').PoolClient

  /** Runs `sql` on the scratch tables and returns the error Postgres raised. */
  const raise = async (sql: string): Promise<Error> => {
    try { await client.query(sql) } catch (e) { return e as Error }
    throw new Error(`expected ${sql} to fail`)
  }
  const wrapped = (cause: Error) => {
    const err = new Error('Failed query: insert into "t3685" ("email") values ($1)')
    ;(err as Error & { cause?: unknown }).cause = cause
    return err
  }
  const rowFor = async (path: string) => {
    const { rows } = await pool.query(
      `SELECT message, stack FROM error_events WHERE url = $1 ORDER BY created_at DESC LIMIT 1`, [path],
    )
    return rows[0] as { message: string; stack: string | null }
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    client = await pool.connect()
    await client.query(`
      CREATE TEMP TABLE p3685 (id int PRIMARY KEY);
      CREATE TEMP TABLE t3685 (id int PRIMARY KEY, email text UNIQUE, pid int REFERENCES p3685(id),
        n text NOT NULL, v int CHECK (v > 0));
      INSERT INTO p3685 VALUES (1);
      INSERT INTO t3685 VALUES (1, '${SECRET}', 1, 'x', 1);
    `)
    await pool.query(`DELETE FROM error_events WHERE url LIKE 'GET /api/__i3685%'`)
  })

  beforeEach(() => resetRequestErrorDedupe())

  afterAll(async () => {
    client.release()
    await pool.query(`DELETE FROM error_events WHERE url LIKE 'GET /api/__i3685%'`)
  })

  // [name, statement, the value Postgres echoes, what must be kept]
  const cases: [string, string, string, string][] = [
    ['unique', `INSERT INTO t3685 VALUES (2, '${SECRET}', 1, 'x', 1)`, SECRET, 'Key (email)=(…) already exists.'],
    ['fk', `INSERT INTO t3685 VALUES (3, 'fk', 93685, 'x', 1)`, '93685', 'Key (pid)=(…) is not present in table "p3685".'],
    ['notnull', `INSERT INTO t3685 VALUES (4, 'nn-${SECRET}', 1, NULL, 1)`, SECRET, 'Failing row contains (…).'],
    ['check', `INSERT INTO t3685 VALUES (5, 'ck-${SECRET}', 1, 'x', -5)`, SECRET, 'Failing row contains (…).'],
    ['cast', `SELECT '${SECRET}'::uuid`, SECRET, 'invalid input syntax for type uuid: "…"'],
  ]

  for (const [name, sql, value, kept] of cases) {
    it(`${name}: Drizzle-wrapped`, async () => {
      const pgErr = await raise(sql)
      // The fixture really carries the value — otherwise the assertion below proves nothing.
      expect(`${pgErr.message} ${(pgErr as { detail?: string }).detail ?? ''}`).toContain(value)

      await recordRequestError(wrapped(pgErr), { path: `/api/__i3685-${name}`, method: 'GET' })
      const row = await rowFor(`GET /api/__i3685-${name}`)
      expect(row.message.startsWith(`[pg ${(pgErr as { code?: string }).code}] `)).toBe(true)
      expect(`${row.message}\n${row.stack}`).not.toContain(value)
      expect(row.stack).toContain(kept)
    })
  }

  it('cast: a raw pg error, not wrapped', async () => {
    const pgErr = await raise(`SELECT '${SECRET}'::uuid`)
    await recordRequestError(pgErr, { path: '/api/__i3685-raw', method: 'GET' })
    const row = await rowFor('GET /api/__i3685-raw')
    expect(row.message).toBe('invalid input syntax for type uuid: "…"')
    expect(row.stack ?? '').not.toContain(SECRET)
  })
})
