// Live battery-poll persistence (migration 133). Proves the real Drizzle insert/read round-trip
// against Postgres (the route test mocks the repo, so this covers the DB layer).
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000ba770'

describe.skipIf(!canRun)('oura battery-poll persistence', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `battery-${TEST_USER_ID}@example.com`],
    )
    await pool.query(`DELETE FROM oura_ble_battery_poll WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_ble_battery_poll WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('persists polls and reads them back in time order within the window', async () => {
    await repo.insertOuraBatteryPoll(TEST_USER_ID, 82, false)
    await repo.insertOuraBatteryPoll(TEST_USER_ID, 100, true)
    await repo.insertOuraBatteryPoll(TEST_USER_ID, 55, null)

    // Window carries ±1h margin: measured_at is stamped by the DB clock (now()), which can run
    // slightly ahead of this runner's clock, so a just-inserted row's measured_at may exceed a
    // JS-captured `new Date()` upper bound and be wrongly excluded (a clock-skew flake in CI).
    const from = new Date(Date.now() - 3_600_000)
    const to = new Date(Date.now() + 3_600_000)
    const polls = await repo.getOuraBatteryPolls(TEST_USER_ID, from, to)

    expect(polls.length).toBe(3)
    expect(polls.map(p => p.percent).sort((a, b) => a - b)).toEqual([55, 82, 100])
    const charged = polls.find(p => p.percent === 100)
    expect(charged?.charging).toBe(true)
    expect(polls.find(p => p.percent === 55)?.charging).toBeNull()
    expect(polls.every(p => p.tsMs >= from.getTime() && p.tsMs <= to.getTime())).toBe(true)
  })

  it('excludes polls outside the requested window', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000)
    const farFuture = new Date(Date.now() + 4 * 86_400_000)
    const polls = await repo.getOuraBatteryPolls(TEST_USER_ID, future, farFuture)
    expect(polls.length).toBe(0)
  })
})
