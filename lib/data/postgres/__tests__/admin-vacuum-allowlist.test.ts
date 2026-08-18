import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { VACUUM_FULL_TABLES, vacuumTableFull } from '@/lib/data/postgres/slices/oura'

// Q-315. The table name is interpolated into `VACUUM (FULL) <table>` because VACUUM accepts no bind
// parameter, so the allowlist is not validation — it IS the safety boundary. These tests exist to
// make that boundary a thing that fails loudly rather than a convention.
//
// Runs only against a real local dev Postgres — skips in CI.
const canRun = !!process.env.DATABASE_URL

describe('the VACUUM FULL allowlist is the safety boundary', () => {
  it('rejects a name outside it, including one that would be valid SQL', async () => {
    for (const bad of ['users', 'oura_raw_packed', 'oura_raw_samples; DROP TABLE users', '']) {
      await expect(vacuumTableFull(bad as never)).rejects.toThrow(/not in the allowlist/)
    }
  })

  // Object.prototype keys are the classic way a `hasOwnProperty`-less check gets fooled — `'toString'
  // in obj` is true for every object. This pins that the check is an own-property one.
  it('rejects inherited Object.prototype keys', async () => {
    for (const key of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      await expect(vacuumTableFull(key as never)).rejects.toThrow(/not in the allowlist/)
    }
  })

  it('lists exactly the two tables a rewrite is wanted on', () => {
    expect(Object.keys(VACUUM_FULL_TABLES).sort()).toEqual(['error_events', 'oura_raw_samples'])
  })
})

describe.skipIf(!canRun)('vacuumTableFull against a real database', () => {
  let pool: import('pg').Pool
  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
  })
  afterAll(async () => {
    // Leave the pool's own timeouts intact — the slice releases its client with release(true)
    // precisely so a timeout-disabled connection never returns to circulation. Assert that here.
    const { rows } = await pool.query(`SHOW statement_timeout`)
    expect(rows[0].statement_timeout).not.toBe('0')
  })

  it('reclaims and reports honestly, and does not poison the pool', async () => {
    const res = await vacuumTableFull('error_events')
    expect(res.table).toBe('error_events')
    expect(res.beforeBytes).toBeGreaterThan(0)
    expect(res.afterBytes).toBeGreaterThan(0)
    expect(res.reclaimedBytes).toBe(Math.max(0, res.beforeBytes - res.afterBytes))
    expect(res.liveRows).toBeGreaterThanOrEqual(0)
    expect(res.ms).toBeGreaterThanOrEqual(0)

    // The next pooled query must still carry the pool's normal timeout.
    const { rows } = await pool.query(`SHOW statement_timeout`)
    expect(rows[0].statement_timeout).not.toBe('0')
  })
})
