// Q-485: the same value, the same field, the same instant, answered two ways —
//
//   POST /api/body-metadata  →  400 {"error":"Too big: expected number to be <=500"}
//   POST /api/sync/push      →  200 {"processed":1,"errors":[]}, weight_kg NULL
//
// The bounds were never the problem: both paths import the same validation/body-metrics.ts, so they
// cannot drift. What differed was the *answer*, and the drop was invisible in all three places it
// could have been recorded — no errors[] entry (so the client confirmed and deleted the mutation),
// no console line, no error_events row.
//
// The fix does NOT throw. A throw quarantines the mutation and the poison-pill rule forbids retrying
// a validation failure forever, so twelve new throw sites would trade an invisible failure for a
// queue of red badges over values the user cannot correct from a badge.
//
// Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000000485'
const DATE = '2026-08-09'

describe.skipIf(!canRun)('out-of-range values on the push path (Q-485)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const push = (payload: Record<string, unknown>) =>
    repo.pushMutations(TEST_USER_ID, [{ id: 'm1', domain: 'body_metrics', date: DATE, payload }])
  const row = async () => {
    const r = await pool.query('SELECT weight_kg, steps, spo2_pct FROM body_metrics WHERE user_id=$1 AND date=$2', [TEST_USER_ID, DATE])
    return r.rows[0] ?? null
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool(); repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x','Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID, `coercion-${TEST_USER_ID}@example.com`])
  })
  beforeEach(async () => { await pool.query('DELETE FROM body_metrics WHERE user_id=$1', [TEST_USER_ID]) })
  afterAll(async () => {
    await pool.query('DELETE FROM body_metrics WHERE user_id=$1', [TEST_USER_ID])
    await pool.query('DELETE FROM users WHERE id=$1', [TEST_USER_ID])
  })

  it('still writes the valid fields and still reports processed — a drop must not dead-letter the rest', async () => {
    const res = await push({ weightKg: 10000, steps: 7000 })

    expect(res.processed).toBe(1)
    expect(res.errors).toEqual([])          // unchanged: not an error, so nothing quarantines
    expect((await row())?.steps).toBe(7000) // the sibling field landed
    expect((await row())?.weight_kg).toBeNull()
  })

  it('names the discarded field and its value in a warning, keyed by mutation id', async () => {
    const res = await push({ weightKg: 10000, steps: 7000 })

    expect(res.warnings).toHaveLength(1)
    expect(res.warnings![0].id).toBe('m1')
    expect(res.warnings![0].domain).toBe('body_metrics')
    expect(res.warnings![0].warning).toContain('weightKg=10000')
  })

  it('reports every discarded field, not just the first', async () => {
    const res = await push({ weightKg: 10000, spo2Pct: 5000, steps: 7000 })

    expect(res.warnings![0].warning).toContain('weightKg=10000')
    expect(res.warnings![0].warning).toContain('spo2Pct=5000')
    expect((await row())?.steps).toBe(7000)
  })

  it('says nothing when every value is in range', async () => {
    const res = await push({ weightKg: 81, steps: 7000 })

    expect(res.warnings).toBeUndefined()
    expect(Number((await row())?.weight_kg)).toBe(81)
  })

  it('a non-numeric field is absent, not discarded — omitting a field is not an error', async () => {
    const res = await push({ steps: 7000 })

    expect(res.warnings).toBeUndefined()
  })
})
