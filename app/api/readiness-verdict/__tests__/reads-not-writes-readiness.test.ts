// #2105 — the readiness verdict is NOT a scoring change, proved against a real database.
//
// The route judges scores `/api/readiness-score` already stored, so every readiness number must
// read the same after it runs as before: the score, the contributors, the model stamp and the row's
// `updated_at`. A mocked repository can only show that one method was not called; this shows the
// table did not move, whichever path might have touched it.
//
// Runs only against a real Postgres — skips without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000002105b01'
// Fixed on both sides: the route judges the date it is given, never the clock.
const DAY = '2026-09-30'
const V5 = 'v5:no-checkin:2026-10-06'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: 'Australia/Brisbane' } })),
}))

describe.skipIf(!canRun)('readiness verdict — reads readiness, never writes it', () => {
  let pool: import('pg').Pool

  const snapshot = async () => (await pool.query(
    `SELECT day::text, readiness_score, readiness_contributors, readiness_source, model_versions, updated_at
       FROM oura_daily_derived WHERE user_id = $1 ORDER BY day`, [TEST_USER_ID])).rows

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')`,
      [TEST_USER_ID, `readiness-verdict-db-${TEST_USER_ID}@example.com`],
    )
    // 28 ordinary days (60–66) and a low day to judge.
    for (let i = 0; i <= 28; i++) {
      const day = shiftDateStr(DAY, -i)
      const score = i === 0 ? 41 : 60 + ((i - 1) % 7)
      await pool.query(
        `INSERT INTO oura_daily_derived (user_id, day, readiness_score, readiness_contributors, readiness_source, model_versions)
         VALUES ($1, $2, $3, $4::jsonb, 'ble-derived', $5::jsonb)`,
        [TEST_USER_ID, day, score,
          JSON.stringify({ hrvBalance: { score: score - 5, provisional: false, input: -0.4, gap: null } }),
          JSON.stringify({ readiness: V5, bodyBattery: 'bb-test' })],
      )
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID]) // cascades every row
  })

  it('judges the stored score, freezes it, and leaves every readiness row untouched', async () => {
    const before = await snapshot()
    expect(before).toHaveLength(29)

    const { GET } = await import('../route')
    const res = await GET(new Request(`http://localhost/api/readiness-verdict?date=${DAY}`))
    expect(res.status).toBe(200)
    const { verdict } = await res.json()
    expect(verdict.verdict).toBe('poor')
    expect(verdict.score).toBe(41)
    expect(verdict.baselineSameVersionDays).toBe(28)

    // The proof: not one readiness number, stamp or timestamp moved.
    expect(await snapshot()).toEqual(before)

    // And the snapshot is the stored row's evidence, held in its own table.
    const { rows } = await pool.query(
      `SELECT score, contributors, readiness_model_version, response_state
         FROM readiness_verdicts WHERE user_id = $1 AND date = $2`, [TEST_USER_ID, DAY])
    expect(rows).toEqual([{
      score: 41,
      contributors: before[28].readiness_contributors,
      readiness_model_version: V5,
      response_state: 'none',
    }])
  })

  it('a later rewrite of the score cannot change the frozen verdict', async () => {
    // What `/api/readiness-score` does on every read of the day.
    await pool.query(
      `UPDATE oura_daily_derived SET readiness_score = 90, updated_at = now() WHERE user_id = $1 AND day = $2`,
      [TEST_USER_ID, DAY])

    const { GET } = await import('../route')
    const { verdict } = await (await GET(new Request(`http://localhost/api/readiness-verdict?date=${DAY}`))).json()
    expect(verdict.verdict).toBe('poor')
    expect(verdict.score).toBe(41)
  })
})
