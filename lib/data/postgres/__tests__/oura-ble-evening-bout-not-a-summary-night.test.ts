// #2487 — the BLE rollup wrote a short evening sleep window as its date's nightly summary.
//
// The rollup resolves each wake date's night through `nightPeriodsByDate`. Before #2487 that picker
// lacked #2456's rule, so on a date whose only night-band window was a one-hour evening bout
// (21:30–22:30, more than three hours before the next night, so never merged into it) the bout
// became that date's `oura_daily_summary` row, carrying evening HRV and heart rate as the night's.
//
// Three dates, each far enough from the others that nothing merges:
//   07-12  only a 21:30–22:45 evening bout                       → no summary row
//   07-14  only a 19:00–23:48 evening sleep (≥ 4 h)              → a row: a main sleep on any clock
//   07-17  a 22:30–06:30 night plus a 21:30–22:45 evening bout   → a row, from the night
// Every window still gets its own `sleep_sessions` row; only the date's night pick changes.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ALWAYS_NIGHT_MIN_HOURS } from '@trainingai/shared/health/sleep-night'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000248701'
const TZ = 'Australia/Brisbane'

const DS_PER_HOUR = 3600 * 10
const DS_PER_DAY = 24 * DS_PER_HOUR
const NOW_DS = 60_000_000
// NOW_DS is 07:00 Brisbane on 2026-07-21.
const ANCHOR_UTC = '2026-07-20T21:00:00.000Z'
/** The ring timestamp of a Brisbane wall-clock time on 2026-07-`day` (hours past 24 roll over). */
const at = (day: number, hour: number) => NOW_DS - (21 - day) * DS_PER_DAY + (hour - 7) * DS_PER_HOUR

const BOUT_ONLY = { start: at(12, 21.5), end: at(12, 22.75) }
const EVENING_MAIN = { start: at(14, 19), end: at(14, 23.8) }
const NIGHT = { start: at(16, 22.5), end: at(17, 6.5) }
const BOUT_AFTER_NIGHT = { start: at(17, 21.5), end: at(17, 22.75) }

async function seedWindow(pool: import('pg').Pool, w: { start: number; end: number }, hrBase: number) {
  const values: string[] = []
  const params: unknown[] = []
  const push = (ds: number, tag: number, name: string, decoded: string) => {
    const b = params.length
    values.push(`($1, $${b + 2}, $${b + 3}, $${b + 4}, 'aa', $${b + 5}::jsonb)`)
    params.push(ds, tag, name, decoded)
  }
  // Windows come from clustering the sleep-only signals (a bedtime_period under three hours is
  // ignored), and HR on every 5-minute epoch keeps the dense-sensing clamp from trimming them.
  const hr = JSON.stringify({ hr_bpm: Array.from({ length: 60 }, (_, i) => hrBase + (i % 10)), rmssd_ms: [40, 44] })
  for (let ds = w.start; ds <= w.end; ds += 5 * 60 * 10) {
    push(ds, 0x72, 'sleep_acm_period', '{}')
    push(ds, 0x75, 'sleep_temp', '{}')
    push(ds, 0x80, 'ibi_and_amplitude_event', hr)
  }
  await pool.query(
    `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${values.join(',')}`,
    [TEST_USER_ID, ...params],
  )
}

describe.skipIf(!canRun)('aggregateOuraRawSamples — a short evening bout is not a date\'s summary night', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const TABLES = [
    'oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics', 'oura_heartrate',
    'oura_daily_summary', 'oura_rollup_state',
  ]

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `ble-evening-bout-${TEST_USER_ID}@example.com`, TZ],
    )
    for (const t of TABLES) await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, NOW_DS, ANCHOR_UTC],
    )
    await seedWindow(pool, BOUT_ONLY, 70)
    await seedWindow(pool, EVENING_MAIN, 52)
    await seedWindow(pool, NIGHT, 48)
    await seedWindow(pool, BOUT_AFTER_NIGHT, 72)
    await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ)
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of TABLES) await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  async function sleepRows() {
    const { rows } = await pool.query<{ date: string; duration_hours: number }>(
      `SELECT date::text AS date, duration_hours::float AS duration_hours FROM sleep_sessions
       WHERE user_id = $1 ORDER BY sleep_start`,
      [TEST_USER_ID],
    )
    return rows
  }
  const summary = () => repo.getOuraDailySummary(TEST_USER_ID, '2026-07-01', '2026-07-31')

  it('still writes every window as its own sleep session (the premise)', async () => {
    const rows = await sleepRows()
    expect(rows.map(r => r.date)).toEqual(['2026-07-12', '2026-07-14', '2026-07-17', '2026-07-17'])
    // The evening main sleep is long enough to count on any clock; the bouts are not.
    expect(rows[1].duration_hours).toBeGreaterThanOrEqual(ALWAYS_NIGHT_MIN_HOURS)
    expect(rows[0].duration_hours).toBeLessThan(ALWAYS_NIGHT_MIN_HOURS)
  })

  it('writes no summary row for a date whose only night-band window is a short evening bout', async () => {
    expect((await summary()).map(r => r.date)).not.toContain('2026-07-12')
  })

  it('still writes an evening sleep of four hours or more as its date\'s night', async () => {
    const row = (await summary()).find(r => r.date === '2026-07-14')
    expect(row?.sleepDurationHours).toBeGreaterThanOrEqual(ALWAYS_NIGHT_MIN_HOURS)
  })

  it('keeps the night, not the evening bout, on a date that has both', async () => {
    const row = (await summary()).find(r => r.date === '2026-07-17')
    expect(row?.sleepDurationHours).toBeGreaterThan(7)
    // The bout was seeded with heart rate 72–81; the night with 48–57.
    expect(row?.rhrLowBpm).toBeLessThan(60)
  })

  it('writes exactly the two nights', async () => {
    expect((await summary()).map(r => r.date)).toEqual(['2026-07-14', '2026-07-17'])
  })
})
