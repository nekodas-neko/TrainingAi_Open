// Q-23 §1 / Q-22 §2: `insertOuraRawSamples` used to mutate a single anchor row forward and
// ignore any batch whose ds went backwards. That meant (a) one row's lag dated all of
// history, and (b) a ring clock reset was silently fatal — every post-reset frame resolved
// weeks into the past and fell below the rollup cutoff, contributing nothing forever.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { bytesToHex } from '@/lib/oura-ble/decode'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000c10c'

function sample(ds: number) {
  const body = [ds & 0xff, (ds >> 8) & 0xff, (ds >> 16) & 0xff, (ds >>> 24) & 0xff, 0x01, 0x02]
  return { ringTimestampDs: ds, tag: 0x84, eventName: 'ambient', bodyHex: bytesToHex(Uint8Array.from(body)) }
}

describe.skipIf(!canRun)('ring clock anchors are append-only observations', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const anchorRows = async () => (await pool.query(
    `SELECT anchor_ds::bigint AS ds, epoch FROM oura_ble_clock_anchors WHERE user_id = $1 ORDER BY id`,
    [TEST_USER_ID],
  )).rows.map(r => ({ ds: Number(r.ds), epoch: r.epoch }))

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `clock-epochs-${TEST_USER_ID}@example.com`],
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

  it('records a new observation per advancing batch instead of overwriting the old one', async () => {
    await repo.insertOuraRawSamples(TEST_USER_ID, [sample(1_000_000)])
    await repo.insertOuraRawSamples(TEST_USER_ID, [sample(1_050_000)])
    await repo.insertOuraRawSamples(TEST_USER_ID, [sample(1_100_000)])
    expect(await anchorRows()).toEqual([
      { ds: 1_000_000, epoch: 0 },
      { ds: 1_050_000, epoch: 0 },
      { ds: 1_100_000, epoch: 0 },
    ])
  })

  it('does not record an observation for a backfill batch that adds no new high-water mark', async () => {
    // A re-sync replaying old frames tells us nothing new about the clock, and recording
    // (oldDs ↔ now) would be an actively wrong correspondence.
    await repo.insertOuraRawSamples(TEST_USER_ID, [sample(1_000_000)])
    await repo.insertOuraRawSamples(TEST_USER_ID, [sample(999_000)])
    expect(await anchorRows()).toEqual([{ ds: 1_000_000, epoch: 0 }])
  })

  it('opens a new epoch when the ring counter restarts, instead of refusing to move', async () => {
    await repo.insertOuraRawSamples(TEST_USER_ID, [sample(9_000_000)])
    await repo.insertOuraRawSamples(TEST_USER_ID, [sample(500)])   // re-key: counter back to ~0
    expect(await anchorRows()).toEqual([
      { ds: 9_000_000, epoch: 0 },
      { ds: 500, epoch: 1 },
    ])
  })

  it('stamps each sample with the epoch it was ingested under', async () => {
    await repo.insertOuraRawSamples(TEST_USER_ID, [sample(9_000_000)])
    await repo.insertOuraRawSamples(TEST_USER_ID, [sample(500)])
    const rows = (await pool.query(
      `SELECT ring_timestamp_ds::bigint AS ds, epoch FROM oura_raw_samples WHERE user_id = $1 ORDER BY epoch`,
      [TEST_USER_ID],
    )).rows.map(r => ({ ds: Number(r.ds), epoch: r.epoch }))
    // Without this, the two ds values are indistinguishable after the fact and the post-reset
    // frame would forever resolve against epoch 0.
    expect(rows).toEqual([{ ds: 9_000_000, epoch: 0 }, { ds: 500, epoch: 1 }])
  })

  it('exposes every observation through getOuraClockAnchors, oldest ds first', async () => {
    await repo.insertOuraRawSamples(TEST_USER_ID, [sample(1_000_000)])
    await repo.insertOuraRawSamples(TEST_USER_ID, [sample(1_050_000)])
    const anchors = await repo.getOuraClockAnchors(TEST_USER_ID)
    expect(anchors.map(a => a.anchorDs)).toEqual([1_000_000, 1_050_000])
    expect(anchors.every(a => a.epoch === 0 && a.anchorUtcMs > 0)).toBe(true)
  })
})
