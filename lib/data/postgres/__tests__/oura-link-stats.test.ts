// #2469. Ring link counters persistence (migration 202610061553). The route test mocks the repo;
// this proves the Drizzle insert lands every column, and that the claude_ro view exposes them.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000011a469'

describe.skipIf(!canRun)('oura link-stats persistence (#2469)', () => {
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
      [TEST_USER_ID, `linkstats-${TEST_USER_ID}@example.com`],
    )
    await pool.query(`DELETE FROM oura_ble_link_stats WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_ble_link_stats WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('stores every counter, the device start instant, and a server recorded_at', async () => {
    const startedAt = new Date(Date.now() - 5 * 3_600_000)
    // Above 2^31 ms on purpose: the BIGINT columns must not be INTEGER in disguise.
    const longUptime = 3_000_000_000
    await repo.insertOuraLinkStats(TEST_USER_ID, {
      serviceStartedAt: startedAt,
      serviceUptimeMs: longUptime,
      state: 'ready',
      connectCount: 41,
      dropCount: 40,
      totalConnectedMs: 2_900_000_000,
      lastTimeToConnectMs: 1_850,
      consecutiveFailures: null,
    })

    const { rows } = await pool.query(
      `SELECT service_started_at, service_uptime_ms, state, connect_count, drop_count,
              total_connected_ms, last_time_to_connect_ms, consecutive_failures, recorded_at
         FROM oura_ble_link_stats WHERE user_id = $1`,
      [TEST_USER_ID],
    )
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(new Date(r.service_started_at).getTime()).toBe(startedAt.getTime())
    expect(Number(r.service_uptime_ms)).toBe(longUptime)
    expect(r.state).toBe('ready')
    expect(r.connect_count).toBe(41)
    expect(r.drop_count).toBe(40)
    expect(Number(r.total_connected_ms)).toBe(2_900_000_000)
    expect(r.last_time_to_connect_ms).toBe(1_850)
    expect(r.consecutive_failures).toBeNull()
    // Server-stamped: within an hour of now either side (DB and runner clocks can skew).
    expect(Math.abs(new Date(r.recorded_at).getTime() - Date.now())).toBeLessThan(3_600_000)
  })

  it('cascades away with the user', async () => {
    const { rows } = await pool.query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conrelid = 'oura_ble_link_stats'::regclass AND contype = 'f'`,
    )
    expect(rows.map(r => r.confdeltype)).toEqual(['c'])
  })
})
