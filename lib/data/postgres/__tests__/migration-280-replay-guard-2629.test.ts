/**
 * Issue 2629 — migration 280 re-added `day_checkins.vs_yesterday` on a replay.
 *
 * 280 adds the column; a later migration renames it to `vs_normal`. On a replay 280 ran again, found
 * no `vs_yesterday` and added a fresh empty one. It is now guarded on `vs_normal`. Both directions
 * are pinned, inside a transaction that is rolled back so the shared test database is never changed.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Pool } from 'pg'

const canRun = !!process.env.DATABASE_URL && !/railway|rlwy\.net/i.test(process.env.DATABASE_URL)
const SQL = readFileSync(join(__dirname, '..', 'migrations', '280_day_checkin_vs_yesterday.sql'), 'utf8')

describe.skipIf(!canRun)('migration 280 on a database that already renamed the column (issue 2629)', () => {
  let pool: Pool
  beforeAll(async () => {
    const { getPool, ensureSchema } = await import('../client')
    await ensureSchema()
    pool = getPool()
  })

  const columns = async (c: import('pg').PoolClient) => (await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='day_checkins' AND column_name IN ('vs_yesterday','vs_normal')`,
  )).rows.map(r => r.column_name as string).sort()

  it('is a no-op once vs_normal exists: it does not add vs_yesterday back', async () => {
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      expect(await columns(c)).toEqual(['vs_normal'])
      await c.query(SQL)
      expect(await columns(c)).toEqual(['vs_normal'])
    } finally {
      await c.query('ROLLBACK').catch(() => {})
      c.release()
    }
  })

  it('still adds vs_yesterday, with its comment, on a database that has not renamed it yet (a fresh build)', async () => {
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query('ALTER TABLE day_checkins RENAME COLUMN vs_normal TO vs_normal_hidden')
      expect(await columns(c)).toEqual([])
      await c.query(SQL)
      expect(await columns(c)).toEqual(['vs_yesterday'])
      const { rows } = await c.query(`SELECT col_description('day_checkins'::regclass, a.attnum) AS comment FROM pg_attribute a WHERE a.attrelid = 'day_checkins'::regclass AND a.attname = 'vs_yesterday'`)
      expect(rows[0].comment).toContain('TN-58 comparative self-report')
    } finally {
      await c.query('ROLLBACK').catch(() => {})
      c.release()
    }
  })

  it('leaves the database as it found it', async () => {
    const c = await pool.connect()
    try { expect(await columns(c)).toEqual(['vs_normal']) } finally { c.release() }
  })
})
