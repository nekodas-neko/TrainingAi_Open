// BF-83: `getSleepCoverageEnd` is how far the BLE rollup's DERIVATION has reached, which is not the
// same as how far ingest has reached — and the difference is the whole bug. On 2026-09-01 the batch
// covering 4:46 → 6:38 was already in `oura_raw_samples` (recorded 6:42) while the sleep row still
// ended at 4:46, because the rollup had not re-run. A measure taken from the raw table would have
// called that night settled four minutes before it grew by 85 minutes.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000083bf'

// One anchor, so the robust offset is exactly this pair and the arithmetic below is checkable.
const ANCHOR_DS = 49_700_000
const ANCHOR_UTC = '2026-08-31T21:00:00.000Z'
const MS_PER_DS = 100

describe.skipIf(!canRun)('getSleepCoverageEnd — the rollup watermark as wall-clock time', () => {
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
      [TEST_USER_ID, `sleep-coverage-${TEST_USER_ID}@example.com`],
    )
  })

  beforeEach(async () => {
    for (const t of ['oura_ble_clock_anchors', 'oura_rollup_state']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
  })

  afterAll(async () => {
    for (const t of ['oura_ble_clock_anchors', 'oura_rollup_state', 'oura_raw_samples']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  async function seedAnchor(ds = ANCHOR_DS, utc = ANCHOR_UTC, epoch = 0) {
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc, epoch) VALUES ($1, $2, $3, $4)`,
      [TEST_USER_ID, ds, utc, epoch],
    )
  }
  async function seedWatermark(ds: number, epoch = 0) {
    await pool.query(
      `INSERT INTO oura_rollup_state (user_id, last_rolled_ds, epoch) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET last_rolled_ds = EXCLUDED.last_rolled_ds, epoch = EXCLUDED.epoch`,
      [TEST_USER_ID, ds, epoch],
    )
  }

  it('resolves the watermark ds through the clock anchors', async () => {
    await seedAnchor()
    // 20 minutes of ring time before the anchor — the lag the rollup actually ran at in production.
    const behindDs = ANCHOR_DS - 20 * 60 * 10
    await seedWatermark(behindDs)
    const end = await repo.getSleepCoverageEnd(TEST_USER_ID)
    expect(end?.getTime()).toBe(Date.parse(ANCHOR_UTC) - 20 * 60 * 1000)
  })

  it('a watermark AHEAD of the ingest anchor still resolves, on the same offset', async () => {
    await seedAnchor()
    await seedWatermark(ANCHOR_DS + 6_000)
    const end = await repo.getSleepCoverageEnd(TEST_USER_ID)
    expect(end?.getTime()).toBe(Date.parse(ANCHOR_UTC) + 6_000 * MS_PER_DS)
  })

  it('is null with no watermark, so no night is badged on a user the rollup has never run for', async () => {
    await seedAnchor()
    expect(await repo.getSleepCoverageEnd(TEST_USER_ID)).toBeNull()
  })

  it('is null with no anchors — a ds cannot be resolved without one', async () => {
    await seedWatermark(ANCHOR_DS)
    expect(await repo.getSleepCoverageEnd(TEST_USER_ID)).toBeNull()
  })

  // A re-key restarts the counter, so a watermark from the old epoch could resolve to any time at
  // all. `getOuraRollupWatermark` refuses it, and this pins that the refusal reaches the caller
  // rather than being papered over with the newest anchor's offset.
  it('refuses a watermark from a previous clock epoch', async () => {
    await seedAnchor(ANCHOR_DS, ANCHOR_UTC, 1)
    await seedWatermark(ANCHOR_DS, 0)
    expect(await repo.getSleepCoverageEnd(TEST_USER_ID)).toBeNull()
  })
})
