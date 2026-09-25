// RV-182 — `insertOuraRawSamples` always stamps `measured_at`, so the backfill that used to catch
// NULLs is not needed.
//
// **This test is the deletion's safety net, not a description of it.** An idempotent
// `UPDATE oura_raw_samples SET measured_at = … WHERE measured_at IS NULL` ran on every ingest,
// commented as a cheap no-op once caught up. Measured against production on 2026-09-25 it was
// 4,932 calls, 90 s, **8.0% of all database time**, and **0 rows updated** — no index serves that
// predicate, so it seq-scanned the hot window every time to find the nothing it always found.
//
// It was removed on the argument that a NULL can no longer be written. That argument is only as
// good as the invariant behind it, and an invariant nothing checks is a comment. So the cases below
// cover the paths where a NULL would have to come from: the ordinary batch, the very first batch a
// user ever sends (no anchor exists yet, which is the case the old backfill genuinely served), a
// batch that opens a new clock epoch, and a re-drain of history whose ds values sit far below the
// epoch's high-water mark. If any of them ever stores a NULL, this fails here — loudly, next to the
// reason — rather than being silently re-dated by a statement nobody remembers.
//
// **It pins PRESENCE, not the dating.** A mutation that takes the anchor from the pre-batch read
// instead of the one this batch just wrote survives every case here, and that is right rather than
// a hole: it produces a differently-dated row, not a NULL one, and the statement being deleted only
// ever touched NULLs. How a ds becomes a wall-clock instant is `measuredAtMs`' concern and is
// tested with it.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { OuraRawSampleInput } from '@/lib/data/repository'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000b182'

describe.skipIf(!canRun)('insertOuraRawSamples — measured_at is never left NULL', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/postgres/adapter').PostgresWorkoutRepository

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    const { PostgresWorkoutRepository } = await import('@/lib/data/postgres/adapter')
    repo = new PostgresWorkoutRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, 'rv182-measured-at@example.com'])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [USER])
  })

  // `decoded` is required on the input and deliberately null: the ingest path stopped persisting it
  // (culling lever 1), so null is what a real batch carries.
  const sample = (ds: number, hex: string): OuraRawSampleInput => ({
    ringTimestampDs: ds, tag: 7, eventName: 'test', bodyHex: hex, decoded: null,
  })

  async function nullCount(): Promise<number> {
    const { rows } = await pool.query(
      `SELECT count(*)::int n FROM oura_raw_samples WHERE user_id = $1 AND measured_at IS NULL`, [USER])
    return rows[0].n
  }
  async function total(): Promise<number> {
    const { rows } = await pool.query(
      `SELECT count(*)::int n FROM oura_raw_samples WHERE user_id = $1`, [USER])
    return rows[0].n
  }

  it('stamps the very first batch, when no anchor exists yet', async () => {
    // The case the backfill actually served: before this batch the user has no anchor at all, so
    // the insert has to create one and date itself against it in the same call.
    expect(await total()).toBe(0)
    await repo.insertOuraRawSamples(USER, [sample(1_000_000, 'aa01'), sample(1_000_100, 'aa02')])
    expect(await total()).toBe(2)
    expect(await nullCount()).toBe(0)
  })

  it('stamps an ordinary follow-on batch', async () => {
    await repo.insertOuraRawSamples(USER, [sample(1_000_000, 'bb01')])
    await repo.insertOuraRawSamples(USER, [sample(1_000_600, 'bb02'), sample(1_001_200, 'bb03')])
    expect(await total()).toBe(3)
    expect(await nullCount()).toBe(0)
  })

  it('stamps a batch that opens a new clock epoch', async () => {
    await repo.insertOuraRawSamples(USER, [sample(9_000_000, 'cc01')])
    // A ds far below the epoch high-water mark with a declared re-key opens an epoch; without one
    // it is classified as a re-drain. Either way the rows must be dated.
    await repo.insertOuraRawSamples(USER, [sample(10, 'cc02')])
    expect(await total()).toBe(2)
    expect(await nullCount()).toBe(0)
  })

  it('stamps a re-drain of history that sits below the epoch high-water mark', async () => {
    await repo.insertOuraRawSamples(USER, [sample(5_000_000, 'dd01')])
    await repo.insertOuraRawSamples(USER, [
      sample(4_900_000, 'dd02'), sample(4_950_000, 'dd03'),
    ])
    expect(await total()).toBe(3)
    expect(await nullCount()).toBe(0)
  })

  it('leaves no NULL behind across a mixed sequence', async () => {
    await repo.insertOuraRawSamples(USER, [sample(2_000_000, 'ee01')])
    await repo.insertOuraRawSamples(USER, [sample(2_000_100, 'ee02')])
    await repo.insertOuraRawSamples(USER, [sample(1_000, 'ee03')])
    await repo.insertOuraRawSamples(USER, [sample(2_000_200, 'ee04')])
    // A byte-identical re-send dedups on (user, ds, tag, body_hex) rather than inserting again.
    await repo.insertOuraRawSamples(USER, [sample(2_000_100, 'ee02')])
    expect(await total()).toBe(4)
    expect(await nullCount()).toBe(0)
  })
})
