// RV-182 ③ — the rollup rewrites the BLE heart-rate window without churning rows that did not
// change.
//
// **The upsert was always right; the delete in front of it made that irrelevant.**
// `upsertOuraHeartrate` has used `ON CONFLICT … DO UPDATE … WHERE bpm IS DISTINCT FROM excluded.bpm`
// since review B1/R1, deliberately, so an idempotent re-roll of unchanged points does not bump
// `updated_at` and re-send them over the Track-B timeseries sync. But every pass ran
// `DELETE … WHERE source = 'ble' AND timestamp >= cutoff` immediately before it, removing exactly
// the rows about to be written — so the conflict target never matched and every row was a fresh
// insert. Measured on production: 628,197 inserts and 574,974 deletes against 140,181 live rows,
// against 95 updates.
//
// The first case below is the one that would have caught it: it asserts `updated_at` does not move
// on an unchanged re-roll, which is invisible to any test that only checks the rows' values.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000d182'
const T0 = Date.UTC(2026, 8, 10, 0, 0, 0)

describe.skipIf(!canRun)('rollup HR window — rewrite without churn', () => {
  let pool: import('pg').Pool
  let io: import('@/lib/oura-ble/rollup/io').RollupIO

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    const { createPostgresRollupIO } = await import('@/lib/data/postgres/rollup-io')
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, 'rv182-churn@example.com'])
    io = createPostgresRollupIO({
      db: client.getDb(), userId: USER,
      getOuraClockAnchor: async () => null,
      getOuraClockAnchors: async () => [],
      upsertBodyMetrics: async () => {},
      getBodyFatCalibration: async () => null,
      refitDaytimeHrvModel: async () => {},
      listSleepSessions: async () => [],
    })
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [USER])
  })

  const at = (min: number) => new Date(T0 + min * 60_000)
  const row = (min: number, bpm: number, source = 'ble') => ({ timestamp: at(min), bpm, source })

  /** One rollup pass over the window: write the series, then drop what is no longer in it. */
  async function pass(rows: { timestamp: Date; bpm: number; source: string }[], cutoffMin = 0) {
    await io.upsertHeartrate(rows)
    await io.deleteBleHeartrateNotIn(at(cutoffMin), rows.map(r => r.timestamp))
  }

  async function snapshot() {
    const { rows } = await pool.query(
      `SELECT timestamp, bpm, source, updated_at FROM oura_heartrate
       WHERE user_id = $1 ORDER BY timestamp`, [USER])
    return rows as { timestamp: Date; bpm: number; source: string; updated_at: Date }[]
  }

  it('does NOT move updated_at when the same series is rolled twice', async () => {
    const series = [row(0, 60), row(5, 62), row(10, 64)]
    await pass(series)
    const before = await snapshot()
    expect(before).toHaveLength(3)

    await new Promise(r => setTimeout(r, 15))
    await pass(series)
    const after = await snapshot()

    expect(after.map(r => r.bpm)).toEqual([60, 62, 64])
    expect(after.map(r => r.updated_at.getTime()), 'an unchanged re-roll re-stamped every row')
      .toEqual(before.map(r => r.updated_at.getTime()))
  })

  it('moves updated_at only for the point whose bpm actually changed', async () => {
    await pass([row(0, 60), row(5, 62), row(10, 64)])
    const before = await snapshot()

    await new Promise(r => setTimeout(r, 15))
    await pass([row(0, 60), row(5, 99), row(10, 64)])
    const after = await snapshot()

    expect(after.map(r => r.bpm)).toEqual([60, 99, 64])
    expect(after[0].updated_at.getTime()).toBe(before[0].updated_at.getTime())
    expect(after[1].updated_at.getTime()).toBeGreaterThan(before[1].updated_at.getTime())
    expect(after[2].updated_at.getTime()).toBe(before[2].updated_at.getTime())
  })

  it('removes a point that disappeared from the window', async () => {
    await pass([row(0, 60), row(5, 62), row(10, 64)])
    await pass([row(0, 60), row(10, 64)])
    expect((await snapshot()).map(r => r.bpm)).toEqual([60, 64])
  })

  it('leaves chest-strap rows in the window alone', async () => {
    await pool.query(
      `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source) VALUES ($1, $2, 150, 'chest_strap')`,
      [USER, at(7).toISOString()])
    await pass([row(0, 60), row(10, 64)])
    const rows = await snapshot()
    expect(rows.map(r => `${r.source}:${r.bpm}`)).toEqual(['ble:60', 'chest_strap:150', 'ble:64'])
  })

  it('leaves rows before the cutoff alone', async () => {
    await pass([row(0, 55), row(5, 56)])
    // A later pass covering only from minute 5 must not touch the earlier point.
    await pass([row(5, 56), row(10, 70)], 5)
    expect((await snapshot()).map(r => r.bpm)).toEqual([55, 56, 70])
  })
})
