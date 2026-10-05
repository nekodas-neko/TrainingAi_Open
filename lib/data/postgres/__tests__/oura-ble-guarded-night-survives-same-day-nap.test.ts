// #2192 (PS-17): 15 of the owner's last 30 dates held a daytime fragment as their ONLY sleep row,
// while `oura_daily_summary` held the real 7–9 h night for the same date. Read from production on
// 2026-10-06: every such row was last written about 2½ days after its night, at exactly the run
// whose cutoff protects the night but not that afternoon's nap.
//
// The mechanism. `run.ts` re-derives only windows that start at least MAX_SLEEP_DS (16 h) after the
// read cutoff — the Q-225 truncation guard, which keeps a night's previously-correct row rather
// than rewriting it from a clipped read. The sleep write then deletes EVERY BLE row for each wake-day
// it writes. A night and the same day's afternoon nap share a wake-day, so once the cutoff has moved
// past the night but not the nap, the run re-derives the nap, deletes the date, and writes the nap
// back alone. The guard protected the night from being rewritten and the delete removed it anyway.
// Nothing after that run ever reads the night again, so the loss is permanent until a Redecode.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000219201'
const TZ = 'Australia/Brisbane'

const DS_PER_DAY = 24 * 3600 * 10
const DS_PER_HOUR = 3600 * 10
const NOW_DS = 60_000_000
// NOW_DS is 07:00 Brisbane on 2026-07-21.
const ANCHOR_UTC = '2026-07-20T21:00:00.000Z'

// 22:00 → 06:30 Brisbane, waking on 2026-07-16.
const NIGHT_START = NOW_DS - 5 * DS_PER_DAY - 9 * DS_PER_HOUR
const NIGHT_END = NIGHT_START + 8.5 * DS_PER_HOUR
// 14:00 → 15:30 the same day: same wake-day as the night, 7.5 h after it, so a separate window.
const NAP_START = NIGHT_START + 16 * DS_PER_HOUR
const NAP_END = NAP_START + 1.5 * DS_PER_HOUR

// The cutoff sits four hours BEFORE the night, so every frame of it is read and nothing is
// truncated. The guard still drops it, because it starts within MAX_SLEEP_DS of the cutoff; the nap
// starts after cutoff + 16 h and is re-derived. This is the run that deleted the night in production.
const CUTOFF = NIGHT_START - 4 * DS_PER_HOUR
const SINCE_GUARDING_NIGHT_ONLY = CUTOFF + 3 * DS_PER_DAY

// A newer night, clear of the cutoff by days. The control: the narrowed run must still write it, so
// an assertion that the guarded date is untouched is not just observing a run that wrote nothing.
const CLEAR_NIGHT_START = NOW_DS - 2 * DS_PER_DAY - 9 * DS_PER_HOUR
const CLEAR_NIGHT_END = CLEAR_NIGHT_START + 8 * DS_PER_HOUR

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
  const hr = JSON.stringify({ hr_bpm: Array.from({ length: 60 }, (_, i) => hrBase + (i % 10)) })
  for (let r = 0; r < 40; r++) push(startDs + Math.floor((r / 40) * (endDs - startDs)), 0x80, 'ibi_and_amplitude_event', hr)

  await pool.query(
    `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${values.join(',')}`,
    [TEST_USER_ID, ...params],
  )
}

describe.skipIf(!canRun)('aggregateOuraRawSamples — a guarded night is not deleted by its own date\'s nap', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const TABLES = ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics', 'oura_heartrate', 'oura_rollup_state']

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `ble-guarded-night-${TEST_USER_ID}@example.com`, TZ],
    )
    for (const t of TABLES) await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, NOW_DS, ANCHOR_UTC],
    )
    await seedWindow(pool, NIGHT_START, NIGHT_END, 50)
    await seedWindow(pool, NAP_START, NAP_END, 62)
    await seedWindow(pool, CLEAR_NIGHT_START, CLEAR_NIGHT_END, 54)
  })

  beforeEach(async () => {
    // The state a healthy full run leaves: all three windows written. No watermark either side of
    // it — a narrowed run persists one, and a setup run that read it would itself be narrowed.
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_rollup_state WHERE user_id = $1`, [TEST_USER_ID])
    await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ)
    await pool.query(`DELETE FROM oura_rollup_state WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    for (const t of TABLES) await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  async function rows() {
    const { rows } = await pool.query<{ date: string; oura_id: string; sleep_start: Date; sleep_end: Date }>(
      `SELECT date::text AS date, oura_id, sleep_start, sleep_end FROM sleep_sessions
       WHERE user_id = $1 ORDER BY sleep_start`,
      [TEST_USER_ID],
    )
    return rows.map(r => ({
      date: r.date,
      ouraId: r.oura_id,
      startLocalHour: Number(new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(r.sleep_start)),
      spanHours: Math.round(((r.sleep_end.getTime() - r.sleep_start.getTime()) / 3_600_000) * 10) / 10,
    }))
  }

  it('the full run writes the night and the nap under the same wake date', async () => {
    const all = await rows()
    const shared = all.filter(r => r.date === '2026-07-16')
    expect(shared.map(r => r.startLocalHour)).toEqual([22, 14])
    expect(shared[0].spanHours).toBeGreaterThan(8)
  })

  it('a run that guards the night but re-derives the nap leaves the night in place', async () => {
    const before = await rows()

    await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ, { sinceDs: SINCE_GUARDING_NIGHT_ONLY })

    // Unfixed, 2026-07-16 comes back holding the 14:00 nap alone — the production shape exactly.
    expect((await rows()).filter(r => r.date === '2026-07-16')).toEqual(before.filter(r => r.date === '2026-07-16'))
  })

  it('the same run still writes the nights it is entitled to', async () => {
    // Remove the control night, then show the narrowed run puts it back. Without this the test
    // above passes on a run that wrote nothing at all.
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1 AND date = '2026-07-19'`, [TEST_USER_ID])

    await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ, { sinceDs: SINCE_GUARDING_NIGHT_ONLY })

    const after = await rows()
    expect(after.filter(r => r.date === '2026-07-19')).toHaveLength(1)
    expect(after.filter(r => r.date === '2026-07-16')).toHaveLength(2)
  })
})
