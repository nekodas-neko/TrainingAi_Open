// BF-19 — the stored half: does the report actually answer "is this route slower than it was".
//
// The cold/warm split is the property under test, not a facet of it. Every merge is a Railway
// deploy and the service worker's cache name is stamped from the deploy SHA, so the device's shell
// is invalidated once per deploy — 80 times on one measured day. A percentile pooling cold and warm
// loads measures release cadence rather than the app, which is worse than no number because it
// looks like an answer.
//
// Runs only against a local dev Postgres; skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000019001'
const OTHER = '00000000-0000-4000-8000-000000019002'

describe.skipIf(!canRun)('app-load report (BF-19)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `app-load-${id}@example.com`])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM app_load_metrics WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  beforeEach(async () => {
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM app_load_metrics WHERE user_id = $1`, [id])
    }
  })

  const add = (route: string, totalMs: number, cold: boolean, userId = USER) =>
    repo.insertAppLoadMetric({ userId, route, totalMs, cold, buildId: 'test' })

  it('stores a metric and reads it back', async () => {
    await add('/health/readiness', 900, true)
    const [row] = await repo.getAppLoadReport(USER, 7)
    expect(row).toMatchObject({ route: '/health/readiness', cold: true, samples: 1, p50Ms: 900, worstMs: 900 })
  })

  // The whole report. A cold shell and a warm one are different questions about the same route.
  it('reports cold and warm as separate rows, not one pooled percentile', async () => {
    for (const ms of [2000, 2100, 2200]) await add('/', ms, true)
    for (const ms of [200, 210, 220]) await add('/', ms, false)

    const rows = await repo.getAppLoadReport(USER, 7)
    expect(rows).toHaveLength(2)
    const cold = rows.find(r => r.cold)!
    const warm = rows.find(r => !r.cold)!
    expect(cold.samples).toBe(3)
    expect(warm.samples).toBe(3)
    expect(cold.p50Ms).toBe(2100)
    expect(warm.p50Ms).toBe(210)
    // Pooled, the p50 would land around 1100 — a number describing neither state.
    expect(cold.p50Ms).toBeGreaterThan(warm.p50Ms * 5)
  })

  it('computes a p95 that tracks the slow tail rather than the median', async () => {
    for (let i = 0; i < 19; i++) await add('/nutrition', 300, false)
    await add('/nutrition', 5000, false)   // the load the owner would actually complain about
    const [row] = await repo.getAppLoadReport(USER, 7)
    expect(row.p50Ms).toBe(300)
    expect(row.p95Ms).toBeGreaterThan(300)
    expect(row.worstMs).toBe(5000)         // p95 hides it; worst is why it is reported too
  })

  it('groups by route, worst first', async () => {
    await add('/fast', 100, false)
    await add('/slow', 4000, false)
    const rows = await repo.getAppLoadReport(USER, 7)
    expect(rows.map(r => r.route)).toEqual(['/slow', '/fast'])
  })

  it('excludes rows outside the window', async () => {
    await add('/', 900, true)
    await pool.query(
      `UPDATE app_load_metrics SET created_at = now() - interval '10 days' WHERE user_id = $1`, [USER])
    expect(await repo.getAppLoadReport(USER, 7)).toHaveLength(0)
    expect(await repo.getAppLoadReport(USER, 14)).toHaveLength(1)
  })

  // The report is per-user and must stay that way — it is reached through an admin route, and an
  // admin reading their own numbers must not silently be reading everyone's.
  it('does not report another user\'s loads', async () => {
    await add('/', 900, true, OTHER)
    expect(await repo.getAppLoadReport(USER, 7)).toHaveLength(0)
    expect(await repo.getAppLoadReport(OTHER, 7)).toHaveLength(1)
  })

  it('keeps a null response-start rather than storing a zero', async () => {
    await repo.insertAppLoadMetric({ userId: USER, route: '/', totalMs: 900, cold: true, responseStartMs: null })
    const { rows } = await pool.query(
      `SELECT response_start_ms FROM app_load_metrics WHERE user_id = $1`, [USER])
    expect(rows[0].response_start_ms).toBeNull()
  })
})
