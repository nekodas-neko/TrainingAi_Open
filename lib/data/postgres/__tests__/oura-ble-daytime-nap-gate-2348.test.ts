// #2348 (owner-approved 2026-10-07): a window that starts in the daytime is written as sleep only if
// it looks like one of the person's own nights. The owner's 25 daytime windows since 08-01 were a
// desk, not a nap (HR 69–87, HRV 16–31 against nights at HR 63, HRV 54), and each one was written
// to `sleep_sessions` as sleep. This seeds a user with fewer than 14 nights, so the population
// default applies (HR at most resting HR + 10), and checks the rollup end to end: the desk window is
// not written, a phantom an earlier pass wrote for it is tombstoned, the low-HR nap is kept, and the
// nights are untouched.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000234801'
const TZ = 'Australia/Brisbane'

const DS_PER_DAY = 24 * 3600 * 10
const DS_PER_HOUR = 3600 * 10
const NOW_DS = 60_000_000
// NOW_DS is 07:00 Brisbane on 2026-07-21.
const ANCHOR_UTC = '2026-07-20T21:00:00.000Z'

// 22:00 → 06:30 Brisbane, waking on 2026-07-17 and 2026-07-18.
const NIGHT1_START = NOW_DS - 4 * DS_PER_DAY - 9 * DS_PER_HOUR
const NIGHT2_START = NOW_DS - 3 * DS_PER_DAY - 9 * DS_PER_HOUR
const NIGHT_LEN = 8.5 * DS_PER_HOUR
// 13:00 → 15:00 on 07-17 at a desk heart rate.
const DESK_START = NIGHT1_START + 15 * DS_PER_HOUR
// 14:00 → 15:30 on 07-18 at a sleeping heart rate.
const NAP_START = NIGHT2_START + 16 * DS_PER_HOUR

async function seedWindow(pool: import('pg').Pool, startDs: number, endDs: number, hrBase: number) {
  const values: string[] = []
  const params: unknown[] = []
  const push = (ds: number, tag: number, name: string, decoded: string) => {
    const b = params.length
    values.push(`($1, $${b + 2}, $${b + 3}, $${b + 4}, 'aa', $${b + 5}::jsonb)`)
    params.push(ds, tag, name, decoded)
  }
  for (let ds = startDs; ds <= endDs; ds += 5 * 60 * 10) {
    push(ds, 0x72, 'sleep_acm_period', '{}')
    push(ds, 0x75, 'sleep_temp', '{}')
  }
  const hr = JSON.stringify({ hr_bpm: Array.from({ length: 60 }, (_, i) => hrBase + (i % 4)) })
  for (let r = 0; r < 40; r++) push(startDs + Math.floor((r / 40) * (endDs - startDs)), 0x80, 'ibi_and_amplitude_event', hr)
  await pool.query(
    `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${values.join(',')}`,
    [TEST_USER_ID, ...params],
  )
}

describe.skipIf(!canRun)('aggregateOuraRawSamples — the daytime nap gate (#2348)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const TABLES = ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics', 'oura_heartrate', 'oura_rollup_state']

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `ble-nap-gate-${TEST_USER_ID}@example.com`, TZ],
    )
    for (const t of TABLES) await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, NOW_DS, ANCHOR_UTC],
    )
    await seedWindow(pool, NIGHT1_START, NIGHT1_START + NIGHT_LEN, 52)
    await seedWindow(pool, NIGHT2_START, NIGHT2_START + NIGHT_LEN, 52)
    await seedWindow(pool, DESK_START, DESK_START + 2 * DS_PER_HOUR, 82)
    await seedWindow(pool, NAP_START, NAP_START + 1.5 * DS_PER_HOUR, 52)
    // Three earlier nights the reference reads back from the table: resting HR 50, so the
    // population bar is 60 bpm. The synthetic nights above stage to 0 h and so teach it nothing.
    for (const d of [1, 2, 3]) {
      // 22:00 → 06:00 Brisbane, waking on 2026-07-0(d+1).
      await pool.query(
        `INSERT INTO sleep_sessions (user_id, oura_id, date, sleep_start, sleep_end, duration_hours, avg_heart_rate, lowest_heart_rate)
         VALUES ($1, $2, $3, $4, $5, 7.5, 55, 50)`,
        [TEST_USER_ID, `ble:seed-${d}`, `2026-07-0${d + 1}`, `2026-07-0${d}T12:00:00Z`, `2026-07-0${d}T20:00:00Z`],
      )
    }
    // The phantom an earlier, ungated pass wrote for the desk window.
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, oura_id, date, sleep_start, sleep_end, duration_hours, avg_heart_rate)
       VALUES ($1, 'ble:phantom', '2026-07-17', '2026-07-17T03:00:00Z', '2026-07-17T05:00:00Z', 2, 83)`,
      [TEST_USER_ID],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of TABLES) await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  async function live() {
    const { rows } = await pool.query<{ date: string; oura_id: string; sleep_start: Date }>(
      `SELECT date::text AS date, oura_id, sleep_start FROM sleep_sessions
       WHERE user_id = $1 AND deleted_at IS NULL ORDER BY sleep_start`,
      [TEST_USER_ID],
    )
    const hour = (d: Date) => Number(new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(d))
    return rows.map(r => `${r.date} ${hour(r.sleep_start)}h`)
  }

  it('writes the nights and the nap, and neither the desk window nor its old phantom', async () => {
    await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ)
    const rows = await live()
    expect(rows.filter(r => r.startsWith('2026-07-17') || r.startsWith('2026-07-18')))
      .toEqual(['2026-07-17 22h', '2026-07-18 22h', '2026-07-18 14h'])
    // The phantom is tombstoned rather than deleted (#2546), so a device that pulled it drops it too.
    const { rows: phantom } = await pool.query(
      `SELECT deleted_at FROM sleep_sessions WHERE user_id = $1 AND oura_id = 'ble:phantom'`, [TEST_USER_ID])
    expect(phantom[0].deleted_at).not.toBeNull()
  })
})
