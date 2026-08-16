// Continuous-capture raw chunk storage (oura_accel_chunks, migration 122): retry
// idempotency via UNIQUE(user_id, started_at), and the 7-day ingest-time prune.
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000d012'

describe.skipIf(!canRun)('oura_accel_chunks storage (continuous capture)', () => {
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
      [TEST_USER_ID, `accel-chunks-${TEST_USER_ID}@example.com`],
    )
    await pool.query(`DELETE FROM oura_accel_chunks WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_accel_chunks WHERE user_id = $1`, [TEST_USER_ID])
  })

  // Declared first so it sees the fresh (per-file) prune throttle: the prune is now throttled
  // (≤1×/24h) + fire-and-forget (H-5c) rather than awaited-on-every-insert, so the FIRST insert of
  // the process fires it and we await a tick for the detached delete to land.
  it('prunes this user\'s chunks older than 7 days on ingest (throttled, fire-and-forget)', async () => {
    await pool.query(
      `INSERT INTO oura_accel_chunks (user_id, started_at, sample_rate, n, steps, magnitudes, created_at)
       VALUES ($1, '2026-06-01T00:00:00Z', 50, 2, 0, '{1,2}', now() - interval '30 days')`,
      [TEST_USER_ID],
    )
    await repo.insertOuraAccelChunk(TEST_USER_ID, {
      startedAt: new Date('2026-07-13T03:00:00Z'), sampleRate: 50, magnitudes: [1, 2, 3], steps: 1,
    })
    await new Promise(r => setTimeout(r, 300)) // let the fire-and-forget delete complete
    const { rows } = await pool.query(
      `SELECT started_at FROM oura_accel_chunks WHERE user_id = $1 ORDER BY started_at`,
      [TEST_USER_ID],
    )
    const starts = rows.map((r: { started_at: Date }) => r.started_at.toISOString())
    expect(starts).not.toContain('2026-06-01T00:00:00.000Z')
    expect(starts).toContain('2026-07-13T03:00:00.000Z')
  })

  it('stores a chunk and makes a client retry a no-op', async () => {
    const startedAt = new Date('2026-07-13T02:00:00Z')
    const chunk = { startedAt, sampleRate: 50, magnitudes: [1000, 1010, 990, 1005], steps: 0 }

    const first = await repo.insertOuraAccelChunk(TEST_USER_ID, chunk)
    expect(first.inserted).toBe(true)

    const retry = await repo.insertOuraAccelChunk(TEST_USER_ID, { ...chunk, steps: 99 })
    expect(retry.inserted).toBe(false)

    const { rows } = await pool.query(
      `SELECT sample_rate, n, steps, magnitudes FROM oura_accel_chunks WHERE user_id = $1 AND started_at = $2`,
      [TEST_USER_ID, startedAt],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].sample_rate).toBe(50)
    expect(rows[0].n).toBe(4)
    expect(rows[0].steps).toBe(0) // retry did not overwrite
    expect(rows[0].magnitudes).toEqual([1000, 1010, 990, 1005])
  })
})
