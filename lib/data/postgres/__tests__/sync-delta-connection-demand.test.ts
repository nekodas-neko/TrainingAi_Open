// Q-308's actual claim, measured against a real pool rather than restated.
//
// `getSyncDelta` fanned 24 queries out with `Promise.all`. Against production's pool of 10 that
// demands 21–24 connections for ONE sync, so a single user's own queries queue against each other
// and pay the network hop again on every acquisition. Measured with the owner's real RTT (p50
// 0.86 ms), serialising is faster at p50 *and* p95 at every concurrency with 21× fewer connections
// — no trade-off to weigh.
//
// This asserts the connection demand directly, by sampling the pool while the call runs. A test of
// the returned delta would pass just as well against the parallel version.
//
// Runs only against a real local dev Postgres — skips cleanly in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL

describe.skipIf(!canRun)('getSyncDelta — connection demand', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let userId: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    const { rows } = await pool.query('SELECT id FROM users LIMIT 1')
    userId = rows[0].id
    // Warm: the first call opens connections and plans queries, which would be measured as demand.
    await repo.getSyncDelta(userId, new Date(0), null, 500)
  })

  afterAll(async () => { /* the shared pool is torn down by the suite */ })

  it('holds one connection at a time across the whole fan-out', async () => {
    const before = pool.totalCount
    let peakOverBaseline = 0
    let peakWaiting = 0
    const tick = setInterval(() => {
      peakOverBaseline = Math.max(peakOverBaseline, pool.totalCount - before)
      peakWaiting = Math.max(peakWaiting, pool.waitingCount)
    }, 1)
    try {
      const delta = await repo.getSyncDelta(userId, new Date(0), null, 500)
      expect(delta).toBeTruthy()
    } finally {
      clearInterval(tick)
    }

    // The parallel version asked for 24 at once. Sampling can miss a peak, so this is a ceiling
    // rather than an equality: anything above a couple would mean the fan-out is still overlapping.
    expect(peakOverBaseline).toBeLessThanOrEqual(1)
    // And nothing queued behind the pool, which is what the 24-wide demand caused.
    expect(peakWaiting).toBe(0)
  })

  it('still returns every domain the delta contract names', async () => {
    // Serialising changes how the reads are ISSUED, not what they return — the pagination contract
    // (packages/shared/src/sync/cursor.ts) is untouched. This guards the half that must not move.
    const delta = await repo.getSyncDelta(userId, new Date(0), null, 500) as Record<string, unknown>
    for (const key of [
      'programs', 'progressionStyles', 'bodyMetrics', 'sleepSessions', 'moodLogs', 'activityLogs',
      'fitnessTests', 'workoutSessions', 'foodLogs', 'supplements', 'supplementLogs', 'injuries',
      'exerciseLogs', 'setLogs', 'personalRecords', 'dayCheckins',
    ]) {
      expect(delta, `delta is missing "${key}"`).toHaveProperty(key)
    }
  })
})
