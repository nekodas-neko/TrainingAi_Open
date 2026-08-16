// Q-213: `aggregateOuraRawSamples` re-read and re-decoded a 35-day window of oura_raw_samples on
// every BLE ingest. At ~985k rows against ~37 days of ring history that is the whole table, and each
// run outlasted the gap between syncs — so runs went back-to-back and pegged the single Node thread
// for 15–30 minutes, starving every other request on the process.
//
// `sinceDs` narrows the read to the span a batch touched. The danger in narrowing is not a wrong
// number, it is DESTRUCTION: the HR-series block deletes every `source='ble'` row from its cutoff
// forward and repopulates it from the windowed read. If the window narrows and that delete does not,
// the run wipes days of HR history it no longer has the raw rows to rewrite. These tests pin that.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000bee6'

const DS_PER_DAY = 24 * 3600 * 10
const NOW_DS = 60_000_000
const ANCHOR_UTC = '2026-07-20T21:00:00.000Z'

// Two nights inside the 14-day HR-series window, far enough apart that a narrowed run covering only
// the recent one would drop the older one if the delete were not clamped.
const OLD_NIGHT_START = NOW_DS - 10 * DS_PER_DAY
const OLD_NIGHT_END = OLD_NIGHT_START + 8 * 3600 * 10
const NEW_NIGHT_START = NOW_DS - 1 * DS_PER_DAY
const NEW_NIGHT_END = NEW_NIGHT_START + 8 * 3600 * 10

async function seedNight(pool: import('pg').Pool, startDs: number, endDs: number, hrBase: number) {
  await pool.query(
    `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded)
     VALUES ($1, $2, 118, 'bedtime_period', 'deadbeef', $3)`,
    [TEST_USER_ID, endDs, JSON.stringify({ bedtime_start_ds: startDs, bedtime_end_ds: endDs })],
  )
  const hr = Array.from({ length: 60 }, (_, i) => hrBase + (i % 10))
  const decoded = JSON.stringify({ hr_bpm: hr })
  const values: string[] = []
  const params: unknown[] = []
  for (let r = 0; r < 40; r++) {
    const ds = startDs + Math.floor((r / 40) * (endDs - startDs))
    const b = params.length
    values.push(`($1, $${b + 2}, 128, 'ibi_and_amplitude_event', 'aa', $${b + 3}::jsonb)`)
    params.push(ds, decoded)
  }
  await pool.query(
    `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${values.join(',')}`,
    [TEST_USER_ID, ...params],
  )
}

describe.skipIf(!canRun)('aggregateOuraRawSamples — incremental sinceDs window', () => {
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
      [TEST_USER_ID, `ble-window-${TEST_USER_ID}@example.com`],
    )
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics', 'oura_heartrate', 'oura_rollup_state']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, NOW_DS, ANCHOR_UTC],
    )
    await seedNight(pool, OLD_NIGHT_START, OLD_NIGHT_END, 48)
    await seedNight(pool, NEW_NIGHT_START, NEW_NIGHT_END, 52)
  })

  afterAll(async () => {
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics', 'oura_heartrate', 'oura_rollup_state']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  async function hrRows() {
    const { rows } = await pool.query<{ timestamp: Date; bpm: number }>(
      `SELECT timestamp, bpm FROM oura_heartrate WHERE user_id = $1 AND source = 'ble' ORDER BY timestamp`,
      [TEST_USER_ID],
    )
    return rows.map(r => `${r.timestamp.toISOString()}|${r.bpm}`)
  }

  async function sleepDates() {
    const { rows } = await pool.query<{ date: string }>(
      `SELECT date::text AS date FROM sleep_sessions WHERE user_id = $1 ORDER BY date`,
      [TEST_USER_ID],
    )
    return rows.map(r => r.date)
  }

  it('a full-window run produces both nights and an HR series spanning both', async () => {
    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')
    expect(await sleepDates()).toHaveLength(2)
    expect((await hrRows()).length).toBeGreaterThan(10)
  })

  it('a narrowed run does not destroy the HR series outside its window', async () => {
    const before = await hrRows()
    expect(before.length).toBeGreaterThan(10)

    // Only the recent night is in scope — the older night's raw rows are outside the read window.
    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane', { sinceDs: NEW_NIGHT_START })

    // Unclamped, the delete would clear 14 days of ble rows and repopulate only the recent night,
    // silently dropping the older night's HR history.
    expect(await hrRows()).toEqual(before)
  })

  it('a narrowed run leaves the older night\'s sleep row in place', async () => {
    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane', { sinceDs: NEW_NIGHT_START })
    expect(await sleepDates()).toHaveLength(2)
  })

  it('is idempotent: narrowed then full produces the same rows as full alone', async () => {
    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane', { sinceDs: NEW_NIGHT_START })
    const afterNarrow = await hrRows()
    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')
    expect(await hrRows()).toEqual(afterNarrow)
    expect(await sleepDates()).toHaveLength(2)
  })

  it('records a watermark so a cold start does not have to re-derive the window', async () => {
    await pool.query(`DELETE FROM oura_rollup_state WHERE user_id = $1`, [TEST_USER_ID])
    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')

    const { rows } = await pool.query<{ last_rolled_ds: string; epoch: number }>(
      `SELECT last_rolled_ds, epoch FROM oura_rollup_state WHERE user_id = $1`, [TEST_USER_ID],
    )
    expect(rows).toHaveLength(1)
    // The run reached the anchor, which is the newest point it could have covered.
    expect(Number(rows[0].last_rolled_ds)).toBe(NOW_DS)
  })

  it('narrows from the persisted watermark when the caller passes no sinceDs', async () => {
    // The cold-start case: no in-process span, but a watermark from an earlier run. Before the
    // watermark existed this re-derived all 35 days — six minutes of a pegged thread in production,
    // on every deploy.
    await pool.query(
      `INSERT INTO oura_rollup_state (user_id, last_rolled_ds, epoch) VALUES ($1, $2, 0)
       ON CONFLICT (user_id) DO UPDATE SET last_rolled_ds = EXCLUDED.last_rolled_ds, epoch = 0`,
      [TEST_USER_ID, NEW_NIGHT_START],
    )
    // Discriminator: wipe the older night's HR rows by hand. A narrowed run cannot see that night's
    // raw rows, so it leaves the hole; a full-window run would refill it. Asserting "nothing was
    // destroyed" would pass either way and prove nothing about narrowing.
    await pool.query(
      `DELETE FROM oura_heartrate WHERE user_id = $1 AND timestamp < $2`,
      [TEST_USER_ID, new Date(Date.parse(ANCHOR_UTC) - 5 * 24 * 3600 * 1000)],
    )
    const afterWipe = (await hrRows()).length

    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')

    expect(await hrRows()).toHaveLength(afterWipe)
    expect(await sleepDates()).toHaveLength(2)
  })

  it('ignores a watermark from a previous clock epoch rather than narrowing against it', async () => {
    // ds restarts from zero on a ring re-key, so a counter from another epoch is not comparable.
    await pool.query(
      `INSERT INTO oura_rollup_state (user_id, last_rolled_ds, epoch) VALUES ($1, $2, 99)
       ON CONFLICT (user_id) DO UPDATE SET last_rolled_ds = EXCLUDED.last_rolled_ds, epoch = 99`,
      [TEST_USER_ID, NEW_NIGHT_START],
    )
    // Same discriminator, opposite expectation: falling back to the full window means the older
    // night IS back in scope, so the hole is refilled.
    await pool.query(
      `DELETE FROM oura_heartrate WHERE user_id = $1 AND timestamp < $2`,
      [TEST_USER_ID, new Date(Date.parse(ANCHOR_UTC) - 5 * 24 * 3600 * 1000)],
    )
    const afterWipe = (await hrRows()).length

    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')

    expect((await hrRows()).length).toBeGreaterThan(afterWipe)
    expect(await sleepDates()).toHaveLength(2)
  })

  it('covers the watermark span even when the caller passes a newer one', async () => {
    // The restart case that the first draft got wrong. A batch lands, the container dies before the
    // rollup runs, and the next batch carries only recent data. Using the caller's span alone would
    // leave everything between the watermark and that batch unrolled, forever.
    await pool.query(
      `INSERT INTO oura_rollup_state (user_id, last_rolled_ds, epoch) VALUES ($1, $2, 0)
       ON CONFLICT (user_id) DO UPDATE SET last_rolled_ds = EXCLUDED.last_rolled_ds, epoch = 0`,
      [TEST_USER_ID, OLD_NIGHT_START],
    )
    // Same discriminator as above: wipe the older night, then run with a span covering only the
    // recent night. The watermark reaches back past the older night, so it must be rebuilt.
    await pool.query(
      `DELETE FROM oura_heartrate WHERE user_id = $1 AND timestamp < $2`,
      [TEST_USER_ID, new Date(Date.parse(ANCHOR_UTC) - 5 * 24 * 3600 * 1000)],
    )
    const afterWipe = (await hrRows()).length

    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane', { sinceDs: NEW_NIGHT_START })

    expect((await hrRows()).length).toBeGreaterThan(afterWipe)
    expect(await sleepDates()).toHaveLength(2)
  })
})
