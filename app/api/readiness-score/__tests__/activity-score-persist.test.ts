// Q-7: the Activity Score was computed on every readiness-score call and then discarded, while
// /api/health/trends fell back to oura_daily.activity_score — NULL every day since the 2026-07-07
// re-key. Activity Score v2 therefore shipped with zero days of history.
//
// This pinned the third compute-and-persist block, alongside the readiness and sleep ones. #2435
// changed WHAT is stored: Q-7 wrote today's in-progress score on every read, so a day's stored
// score was whatever it was at the last app open. Today is now live-only, and a finished day is
// stored once, over the whole day, stamped final.
// Runs only against a real Postgres — skips without DATABASE_URL (CI's Tests job sets one).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000005c7'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: 'Australia/Brisbane' } })),
}))

describe.skipIf(!canRun)('readiness-score — Activity Score persist (Q-7)', () => {
  let pool: import('pg').Pool
  let today: string
  let yesterday: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { todayInTz, shiftDateStr } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    today = todayInTz('Australia/Brisbane')
    yesterday = shiftDateStr(today, -1)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `activity-persist-${TEST_USER_ID}@example.com`],
    )
    // computeActivityScore returns null with no inputs at all, which would make every assertion
    // below vacuous — the first version of this test passed while persisting nothing. Seed real
    // steps + active calories so the route actually produces a score to store.
    for (const date of [yesterday, today]) {
      await pool.query(
        `INSERT INTO body_metrics (user_id, date, steps, active_calories, weight_kg)
         VALUES ($1, $2, 9000, 450, 82.5)
         ON CONFLICT (user_id, date) DO UPDATE SET steps = 9000, active_calories = 450`,
        [TEST_USER_ID, date],
      )
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID]) // cascades
  })

  const stored = async (day: string) => {
    const { rows } = await pool.query(
      `SELECT activity_score, activity_contributors FROM oura_daily_derived WHERE user_id = $1 AND day = $2`,
      [TEST_USER_ID, day])
    return rows[0] ?? null
  }

  it("serves today's Activity Score live and stores yesterday's as final", async () => {
    const { GET } = await import('../route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    // No conditional skip here on purpose: beforeAll seeds real steps + active calories precisely so
    // a score MUST be produced. The first version of this test allowed a null branch and passed
    // while persisting nothing at all.
    expect(body.activityScore).not.toBeNull()

    // Today's in-progress value is not stored (#2435).
    expect((await stored(today))?.activity_score ?? null).toBeNull()

    // Yesterday, a finished day with the same inputs, is stored once and stamped final.
    const row = await stored(yesterday)
    expect(row).not.toBeNull()
    expect(row.activity_score).toBe(Math.round(body.activityScore))
    // The blend is recorded alongside, so a stored score can be explained after the fact.
    expect(row.activity_contributors).toHaveProperty('adjustment')
    expect(row.activity_contributors).toHaveProperty('trained')
    expect(row.activity_contributors.finalisedAt).toBeGreaterThan(0)
  })

  it('does not clobber the row’s shared provenance columns', async () => {
    // The COALESCE upsert replaces source/model_versions wholesale, so the finalise must not pass
    // them — the readiness and sleep blocks have the same constraint on the same row. Clearing the
    // stamp makes the next read finalise yesterday again, over a row that already has a source.
    await pool.query(
      `UPDATE oura_daily_derived SET source = 'ble-derived', activity_contributors = activity_contributors - 'finalisedAt'
       WHERE user_id = $1 AND day = $2`,
      [TEST_USER_ID, yesterday])

    const { GET } = await import('../route')
    await GET()

    const { rows: [row] } = await pool.query(
      `SELECT source, activity_contributors FROM oura_daily_derived WHERE user_id = $1 AND day = $2`, [TEST_USER_ID, yesterday])
    expect(row.activity_contributors.finalisedAt).toBeGreaterThan(0)
    expect(row.source).toBe('ble-derived')
  })
})
