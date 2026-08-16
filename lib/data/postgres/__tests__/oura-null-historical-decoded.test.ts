// Culling Lever 1b — proves the batched backfill nulls `decoded` on historical rows without
// touching `body_hex`, is idempotent/resumable, and that a decode-from-hex read still produces the
// correct result afterward (the Lever 1a safety guard this backfill relies on).
//
// Runs only against a real local dev Postgres — skips cleanly in CI without a DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000decf1'

// Real captured vector: 0x5d hrv_event '3c283e2d3a32' -> hr [60,62,58], rmssd [40,45,50].
const HRV_HEX = '3c283e2d3a32'
const ROW_COUNT = 12

describe.skipIf(!canRun)('nullHistoricalDecoded — Lever 1b backfill', () => {
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
      [TEST_USER_ID, `null-decoded-${TEST_USER_ID}@example.com`],
    )
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])

    // Seed rows carrying BOTH decoded and body_hex — simulating pre-Lever-1a history.
    const values: string[] = []
    const params: unknown[] = [TEST_USER_ID]
    for (let i = 0; i < ROW_COUNT; i++) {
      const b = params.length
      values.push(`($1, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::jsonb)`)
      params.push(1_000_000 + i * 1000, 0x5d, 'hrv_event', HRV_HEX, JSON.stringify({ hr_bpm: [60, 62, 58], rmssd_ms: [40, 45, 50], interval_min: 5 }))
    }
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${values.join(',')}`,
      params,
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('nulls decoded in bounded batches, leaves body_hex untouched, and is resumable', async () => {
    // First pass, capped smaller than the seed to prove batching/resume works.
    const first = await repo.nullHistoricalDecoded(TEST_USER_ID, 5)
    expect(first.nulled).toBe(5)
    expect(first.remaining).toBe(ROW_COUNT - 5)

    // Second pass finishes the rest.
    const second = await repo.nullHistoricalDecoded(TEST_USER_ID, 100)
    expect(second.nulled).toBe(ROW_COUNT - 5)
    expect(second.remaining).toBe(0)

    // Idempotent: a further call nulls nothing more.
    const third = await repo.nullHistoricalDecoded(TEST_USER_ID, 100)
    expect(third.nulled).toBe(0)
    expect(third.remaining).toBe(0)

    const { rows } = await pool.query(
      `SELECT decoded, body_hex FROM oura_raw_samples WHERE user_id = $1`,
      [TEST_USER_ID],
    )
    expect(rows.length).toBe(ROW_COUNT)
    for (const r of rows) {
      expect(r.decoded).toBeNull()
      expect(r.body_hex).toBe(HRV_HEX) // archival, untouched
    }
  })

  it('reads still decode correctly from body_hex after the backfill', async () => {
    const raw = await repo.getOuraRawSamplesByTags(TEST_USER_ID, [0x5d], 5)
    expect(raw.length).toBeGreaterThan(0)
    expect((raw[0].decoded as Record<string, unknown>)?.rmssd_ms).toEqual([40, 45, 50])
  })
})

// Owner-requested: the default clears the whole backlog in one press, not just one 500-row batch.
const BIG_USER_ID = '00000000-0000-4000-8000-0000000decf2'
const BIG_ROW_COUNT = 1200 // spans 3 internal 500-row batches under the default maxRows

describe.skipIf(!canRun)('nullHistoricalDecoded — default clears a multi-batch backlog in one call', () => {
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
      [BIG_USER_ID, `null-decoded-big-${BIG_USER_ID}@example.com`],
    )
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [BIG_USER_ID])

    const values: string[] = []
    const params: unknown[] = [BIG_USER_ID]
    for (let i = 0; i < BIG_ROW_COUNT; i++) {
      const b = params.length
      values.push(`($1, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::jsonb)`)
      params.push(2_000_000 + i * 1000, 0x5d, 'hrv_event', HRV_HEX, JSON.stringify({ hr_bpm: [60], rmssd_ms: [40], interval_min: 5 }))
    }
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${values.join(',')}`,
      params,
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [BIG_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [BIG_USER_ID])
  })

  it('nulls the entire backlog in a single call with no explicit maxRows', async () => {
    const result = await repo.nullHistoricalDecoded(BIG_USER_ID) // uses the default (no cap arg)
    expect(result.nulled).toBe(BIG_ROW_COUNT)
    expect(result.remaining).toBe(0)

    const { rows: stillDecoded } = await pool.query(
      `SELECT count(*)::int AS n FROM oura_raw_samples WHERE user_id = $1 AND decoded IS NOT NULL`,
      [BIG_USER_ID],
    )
    expect(stillDecoded[0].n).toBe(0)
  })
})
