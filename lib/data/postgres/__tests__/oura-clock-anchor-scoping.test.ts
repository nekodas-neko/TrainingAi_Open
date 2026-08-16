// Q-143: `insertOuraRawSamples` used to load EVERY clock anchor for the user on every ingest
// batch and reduce in JS. In production that made it the single hottest scan in the database —
// 17,045 sequential scans reading 45,278,531 tuples from a 3,297-row table — and the cost grew
// for the life of the ring, because the anchor table has no pruning.
//
// An index was not the answer: the query returned all rows for the only user, so a sequential
// scan was the correct plan for it. The call pattern was the defect. It now issues two
// single-row reads instead.
//
// This test pins the two replacements as *equivalent* to the full read they replaced, rather
// than merely working — that equivalence is the whole safety argument for touching the ring
// clock path, and it is what would break if someone later "simplified" one of these queries.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { bytesToHex } from '@/lib/oura-ble/decode'
import { currentEpoch, type ClockAnchor } from '@/lib/oura-ble/clock'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000c14e'

function sample(ds: number) {
  const body = [ds & 0xff, (ds >> 8) & 0xff, (ds >> 16) & 0xff, (ds >>> 24) & 0xff, 0x01, 0x02]
  return { ringTimestampDs: ds, tag: 0x84, eventName: 'ambient', bodyHex: bytesToHex(Uint8Array.from(body)) }
}

/** What the removed code computed, recomputed here from the full anchor list. */
function oldEpochHead(anchors: ClockAnchor[]) {
  const epoch = currentEpoch(anchors)
  if (epoch === null) return null
  const maxAnchorDs = anchors.filter(a => a.epoch === epoch).reduce((m, a) => Math.max(m, a.anchorDs), -Infinity)
  return { epoch, maxAnchorDs }
}

/** What the removed `anchors.reduce(...)` picked to stamp `measured_at`. */
function oldNewestByUtc(anchors: ClockAnchor[]) {
  if (anchors.length === 0) return null
  const a = anchors.reduce((newest, x) => (x.anchorUtcMs > newest.anchorUtcMs ? x : newest), anchors[0])
  return { anchorDs: a.anchorDs, anchorUtcMs: a.anchorUtcMs }
}

describe.skipIf(!canRun)('Q-143: scoped clock-anchor reads match the full-table reduce', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adapter: any

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    adapter = repo
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `clock-scoping-${TEST_USER_ID}@example.com`],
    )
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('both reads return null when the user has no anchors', async () => {
    expect(await adapter.getOuraClockEpochHead(TEST_USER_ID)).toBeNull()
    expect(await adapter.getNewestOuraClockAnchorByUtc(TEST_USER_ID)).toBeNull()
    // The old code's null case too — this is what forces the first observation to be written.
    expect(currentEpoch(await repo.getOuraClockAnchors(TEST_USER_ID))).toBeNull()
  })

  it('agrees with the full read across a forward drain and a clock reset', async () => {
    // A forward-moving drain opens epoch 0 and advances its high-water mark, then a batch far
    // below that mark is a re-key / dead battery and opens epoch 1. Both shapes must agree.
    for (const ds of [1_000_000, 1_000_600, 1_001_200, 5_000, 5_600]) {
      await repo.insertOuraRawSamples(TEST_USER_ID, [sample(ds)])
    }

    const anchors = await repo.getOuraClockAnchors(TEST_USER_ID)
    expect(anchors.length).toBeGreaterThan(1)
    // The reset actually happened, otherwise this only tests the easy path.
    expect(new Set(anchors.map(a => a.epoch)).size).toBe(2)

    expect(await adapter.getOuraClockEpochHead(TEST_USER_ID)).toEqual(oldEpochHead(anchors))
    expect(await adapter.getNewestOuraClockAnchorByUtc(TEST_USER_ID)).toEqual(oldNewestByUtc(anchors))
  })

  it('picks the highest ds within the newest epoch, not the highest ds overall', async () => {
    // The distinguishing case: after a reset, epoch 1's ds values are far BELOW epoch 0's. A
    // `max(anchor_ds)` without the epoch grouping would return epoch 0's mark and every
    // subsequent batch would look like a fresh reset.
    for (const ds of [9_000_000, 9_000_600, 4_000, 4_600]) {
      await repo.insertOuraRawSamples(TEST_USER_ID, [sample(ds)])
    }

    const head = await adapter.getOuraClockEpochHead(TEST_USER_ID)
    const anchors = await repo.getOuraClockAnchors(TEST_USER_ID)
    const overallMax = anchors.reduce((m, a) => Math.max(m, a.anchorDs), -Infinity)

    expect(head).toEqual(oldEpochHead(anchors))
    expect(head.epoch).toBe(1)
    expect(head.maxAnchorDs).toBe(4_600)
    expect(head.maxAnchorDs).toBeLessThan(overallMax)
  })

  it('does not see another user\'s anchors', async () => {
    const OTHER = '00000000-0000-4000-8000-00000000c14f'
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [OTHER, `clock-scoping-other-${OTHER}@example.com`],
    )
    try {
      await repo.insertOuraRawSamples(OTHER, [sample(7_777_000)])
      expect(await adapter.getOuraClockEpochHead(TEST_USER_ID)).toBeNull()
      expect(await adapter.getNewestOuraClockAnchorByUtc(TEST_USER_ID)).toBeNull()
    } finally {
      await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [OTHER])
      await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [OTHER])
      await pool.query(`DELETE FROM users WHERE id = $1`, [OTHER])
    }
  })
})
