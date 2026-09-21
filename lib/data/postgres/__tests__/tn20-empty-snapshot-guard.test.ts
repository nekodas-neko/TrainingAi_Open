// TN-20 — a read with no HR samples used to overwrite a completed day with an empty one.
//
// `body_battery_daily` has exactly ONE writer: `GET /api/body-battery`, which snapshots the row on
// every read so that the last read of the day lands as the end-of-day record. When a read's
// waking-hours query came back empty it computed a whole day of nothing — count 0, charged 0,
// drained 0, `endValue` back at the anchor — and wrote it over a correct row.
//
// **The entry expected a recompute with a delete-before-guard (the Q-528 shape). There is none.**
// The destructive write is an ordinary GET, which is why nothing looked suspicious.
//
// Measured in production 2026-09-21: 4 of 84 days store `hr_sample_count = 0` against 272, 265,
// 1,954 and 3,767 raw samples. The entry said "3 of the last 11 days" and "it is losing days now";
// the newest is 2026-08-31, so the mechanism has not fired in three weeks. It was never fixed —
// the guard did not exist until now — so this pins it rather than trusting that it stays quiet.
//
// Runs only against a local dev Postgres — skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000c020'
const DATE = '2026-08-31'

describe.skipIf(!canRun)('an empty snapshot never flattens a populated day (TN-20)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, `tn20-${USER}@example.com`])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM body_battery_daily WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM body_battery_daily WHERE user_id = $1`, [USER])
  })

  /** The shape the route writes. `count: 0` is the destructive form. */
  type Row = import('@/lib/data/repository').BodyBatteryDailyRow
  const snapshot = (count: number, over: Partial<Row> = {}): Row => ({
    date: DATE,
    anchor: 55,
    anchorSource: 'readiness',
    endValue: count === 0 ? 55 : 42,
    dayMin: count === 0 ? 55 : 40,
    dayMax: count === 0 ? 55 : 80,
    totalCharged: count === 0 ? 0 : 14,
    totalDrained: count === 0 ? 0 : 113,
    restingHr: 60,
    hrMax: 190,
    hrMaxObserved: count === 0 ? null : 165,
    hrSampleCount: count,
    modelVersion: '1',
    ...over,
  })

  const read = async () => {
    const { rows } = await pool.query(
      `SELECT hr_sample_count, total_drained, total_charged, end_value
       FROM body_battery_daily WHERE user_id = $1 AND date = $2`, [USER, DATE])
    return rows[0]
  }

  // The production case, exactly: a real day, then a read that sees nothing.
  it('a sample-less read leaves the completed day alone', async () => {
    await repo.upsertBodyBatteryDaily(USER, snapshot(3767))
    await repo.upsertBodyBatteryDaily(USER, snapshot(0))

    const row = await read()
    expect(row.hr_sample_count).toBe(3767)
    expect(Number(row.total_drained)).toBe(113)
    expect(Number(row.end_value)).toBe(42)
  })

  // The entry's pass test, met by the write path rather than a backfill: a day flattened in the
  // morning heals itself on the next read that has samples.
  it('a later read WITH samples repairs a day that was already flattened', async () => {
    await repo.upsertBodyBatteryDaily(USER, snapshot(0))
    expect((await read()).hr_sample_count).toBe(0)

    await repo.upsertBodyBatteryDaily(USER, snapshot(3767))

    const row = await read()
    expect(row.hr_sample_count).toBe(3767)
    expect(Number(row.total_drained)).toBe(113)
  })

  // CONTROL 1 — the guard must not block the ordinary case it looks like. Counts grow through the
  // day and every read is meant to win; a fix that only ever allowed increases would pass the two
  // tests above and still be wrong here.
  it('a normal read still overwrites an earlier one, in both directions', async () => {
    await repo.upsertBodyBatteryDaily(USER, snapshot(1200))
    await repo.upsertBodyBatteryDaily(USER, snapshot(3767, { totalDrained: 99 }))
    expect(Number((await read()).total_drained)).toBe(99)

    // ...and DOWNWARD, which a monotonic guard would have frozen. Waking-hours windowing means a
    // stored count sits slightly below raw on healthy days; only zero-against-thousands is the bug.
    await repo.upsertBodyBatteryDaily(USER, snapshot(900, { totalDrained: 77 }))
    const row = await read()
    expect(row.hr_sample_count).toBe(900)
    expect(Number(row.total_drained)).toBe(77)
  })

  // CONTROL 2 — a genuinely sample-less day must still be recordable. The guard blocks
  // populated → empty, not empty itself.
  it('still inserts, and still re-writes, a day that really has no samples', async () => {
    await repo.upsertBodyBatteryDaily(USER, snapshot(0))
    expect((await read()).hr_sample_count).toBe(0)

    await repo.upsertBodyBatteryDaily(USER, snapshot(0, { anchor: 61, endValue: 61 }))
    const row = await read()
    expect(row.hr_sample_count).toBe(0)
    expect(Number(row.end_value)).toBe(61)
  })
})
