// BF-222 — a failed sensor retention prune leaves a row in error_events, not only a stdout line.
import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const canRun = !!process.env.DATABASE_URL

describe('BF-222 prune failures are recorded', () => {
  it('both sensor prunes route their failure through recordPruneFailure', () => {
    const src = readFileSync(join(process.cwd(), 'lib/data/postgres/slices/oura.ts'), 'utf8')
    expect(src).toMatch(/DELETE FROM oura_heartrate[^\n]*\.catch\(err => recordPruneFailure\(db, 'oura_heartrate', err\)\)/)
    expect(src).toMatch(/DELETE FROM rr_intervals[^\n]*\.catch\(err => recordPruneFailure\(db, 'rr_intervals', err\)\)/)
    expect(src).not.toMatch(/console\.error\('\[prune\] (oura_heartrate|rr_intervals) failed:'/)
  })

  describe.skipIf(!canRun)('against a real database', () => {
    let pool: import('pg').Pool
    afterAll(async () => { if (canRun && pool) await pool.query(`DELETE FROM error_events WHERE url = 'prune:bf222_test'`) })

    it('writes an error_events row naming the table', async () => {
      const { getDb, getPool } = await import('@/lib/data/postgres/client')
      const { recordPruneFailure } = await import('@/lib/data/postgres/slices/oura')
      pool = getPool()
      recordPruneFailure(getDb(), 'bf222_test', new Error('simulated delete failure'))
      let rows: { message: string; source: string }[] = []
      for (let i = 0; i < 20 && rows.length === 0; i++) {
        await new Promise(r => setTimeout(r, 100))
        rows = (await pool.query(`SELECT message, source FROM error_events WHERE url = 'prune:bf222_test'`)).rows
      }
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ source: 'server' })
      expect(rows[0].message).toContain('bf222_test retention DELETE failed: simulated delete failure')
    })
  })
})
