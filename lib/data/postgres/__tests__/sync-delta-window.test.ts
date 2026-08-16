// getSyncDelta full-history unclamp (Phase-2 durability F1). The default 90-day floor clamps
// `since` up to now-90d so a normal pull never re-scans ancient rows; the restore path passes
// `windowDays=null` to skip the floor entirely and honour the real `since` (epoch = full history).
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
// Was …d012, which oura-accel-chunks.test.ts also used. Two DB-touching files on one id delete each
// other's rows in parallel workers; `scripts/check-test-user-ids.js` keeps them distinct.
const TEST_USER_ID = '00000000-0000-4000-8000-00000000d0a5'
const TZ = 'Australia/Brisbane'
const OLD_DATE = '2025-01-01'    // ~200+ days before any run date
const RECENT_DATE = '2099-01-01' // a sentinel far-future date so it's always inside the 90d window

describe.skipIf(!canRun)('getSyncDelta full-history window (F1)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `sync-window-${TEST_USER_ID}@example.com`, TZ],
    )
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    // Ancient row: updated_at 200 days ago (outside the 90-day floor).
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, steps, updated_at) VALUES ($1, $2, 111, now() - interval '200 days')`,
      [TEST_USER_ID, OLD_DATE],
    )
    // Recent row: updated_at now (inside the floor).
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, steps, updated_at) VALUES ($1, $2, 222, now())`,
      [TEST_USER_ID, RECENT_DATE],
    )
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
  })

  const dates = (rows: { date: string }[]) => rows.map(r => r.date).sort()

  it('default (90-day floor) pull from epoch misses the 200-day-old row', async () => {
    const delta = await repo.getSyncDelta(TEST_USER_ID, new Date(0))
    const d = dates(delta.bodyMetrics)
    expect(d).toContain(RECENT_DATE)
    expect(d).not.toContain(OLD_DATE) // clamped up to now-90d, so the ancient row is excluded
  })

  it('windowDays=null (restore) pull from epoch includes the full history', async () => {
    const delta = await repo.getSyncDelta(TEST_USER_ID, new Date(0), null)
    const d = dates(delta.bodyMetrics)
    expect(d).toContain(RECENT_DATE)
    expect(d).toContain(OLD_DATE) // no floor → the 200-day-old row is included
  })

  it('windowDays=null still honours a non-epoch since (only newer rows)', async () => {
    // A since between the two rows' updated_at: only the recent row qualifies.
    const delta = await repo.getSyncDelta(TEST_USER_ID, new Date(Date.now() - 100 * 24 * 3600 * 1000), null)
    const d = dates(delta.bodyMetrics)
    expect(d).toContain(RECENT_DATE)
    expect(d).not.toContain(OLD_DATE)
  })
})
