/**
 * Issue 2603 — a migration's `RAISE NOTICE` reached no log.
 *
 * node-postgres delivers a notice as an event on the client, and the runners sent each migration
 * through `pool.query()`, which checks a client out for one statement and returns it with no
 * listener attached. The counts migrations 295 and 296 print for release day were dropped on the
 * floor. These run a fixture migration through both runners (`ensureSchema`'s and the standalone
 * `scripts/local-db/migrate.js`) against the local database and read what was logged.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import type { Pool } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL
const canRun = !!DATABASE_URL && !/railway|rlwy\.net/i.test(DATABASE_URL)

const NOTICE_SQL = `DO $$ BEGIN RAISE NOTICE 'normalised % rows, skipped %', 3, 1; END $$;`
const FAILS_AFTER_DDL_SQL = `CREATE TABLE tmp_notice_2603_atomic (id int); SELECT 1/0;`

describe.skipIf(!canRun)('migration notices are logged with the file that raised them (issue 2603)', () => {
  let pool: Pool
  let runners: Array<{ name: string; tag: string; run: (p: Pool, f: string, sql: string) => Promise<void> }>

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    const migrateJs = createRequire(import.meta.url)('../../../../scripts/local-db/migrate.js') as {
      runMigrationFile: (p: Pool, f: string, sql: string) => Promise<void>
    }
    runners = [
      { name: 'ensureSchema', tag: 'ensureSchema', run: (p, f, s) => client.runMigrationFile(p, f, s) },
      { name: 'migrate.js', tag: 'migrate', run: migrateJs.runMigrationFile },
    ]
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await pool.query('DROP TABLE IF EXISTS tmp_notice_2603_atomic')
  })

  it.each([0, 1])('runner %i logs the NOTICE prefixed with the file name', async (i) => {
    const r = runners[i]
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await r.run(pool, '999_fixture_notice.sql', NOTICE_SQL)
    const lines = info.mock.calls.map(c => String(c[0]))
    expect(lines).toContain(`[${r.tag}] 999_fixture_notice.sql NOTICE: normalised 3 rows, skipped 1`)
  })

  it.each([0, 1])('runner %i leaves no listener on the connection it hands back', async (i) => {
    await runners[i].run(pool, '999_fixture_notice.sql', NOTICE_SQL)
    const c = await pool.connect()
    try {
      expect(c.listenerCount('notice')).toBe(0)
    } finally {
      c.release()
    }
  })

  it.each([0, 1])('runner %i keeps a multi-statement file one transaction: a failure leaves nothing behind', async (i) => {
    await expect(runners[i].run(pool, '999_fixture_fails.sql', FAILS_AFTER_DDL_SQL)).rejects.toThrow()
    const { rows } = await pool.query(`SELECT to_regclass('tmp_notice_2603_atomic') AS t`)
    expect(rows[0].t).toBeNull()
  })

  it('still releases the connection when the file fails, so a failing migration cannot drain the pool', async () => {
    for (let n = 0; n < 12; n++) {
      await expect(runners[0].run(pool, '999_fixture_fails.sql', FAILS_AFTER_DDL_SQL)).rejects.toThrow()
    }
    const { rows } = await pool.query('SELECT 1 AS ok')
    expect(rows[0].ok).toBe(1)
  })
})
