// Per-workout HR snapshot persistence + rr_intervals retention prune (migration 135, review
// H-3 / H-1 / Lever W+R). Proves the real Drizzle round-trip against Postgres: the COALESCE
// fuller-wins upsert, the missing-list backfill work-list, and the 90-day rr prune.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000ba771'

const sid = (n: number) => `00000000-0000-4000-8000-00000000ba7${n}`

describe.skipIf(!canRun)('workout HR stats + rr retention', () => {
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
      [TEST_USER_ID, `hrstats-${TEST_USER_ID}@example.com`],
    )
    await pool.query(`DELETE FROM workout_hr_stats WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM rr_intervals WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_hr_stats WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM rr_intervals WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('prunes rr_intervals older than 90 days on write, keeps recent (Lever R / H-1)', async () => {
    const old = new Date(Date.now() - 120 * 86_400_000)
    await pool.query(
      `INSERT INTO rr_intervals (user_id, at, rr_ms) VALUES ($1, $2, 800) ON CONFLICT DO NOTHING`,
      [TEST_USER_ID, old],
    )
    // This insert is the first insertRrIntervals call in this module → the 24h throttle is unfired,
    // so the 90d prune runs (fire-and-forget, hence the settle wait below).
    await repo.insertRrIntervals(TEST_USER_ID, [{ at: new Date(), rrMs: 810 }])
    await new Promise(r => setTimeout(r, 300))

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM rr_intervals WHERE user_id = $1 AND at < now() - interval '90 days'`,
      [TEST_USER_ID],
    )
    expect(rows[0].n).toBe('0')
    const recent = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM rr_intervals WHERE user_id = $1`,
      [TEST_USER_ID],
    )
    expect(recent.rows[0].n).toBe('1') // only the just-inserted recent beat survives
  })

  it('persists a snapshot and reads it back', async () => {
    await pool.query(
      `INSERT INTO workout_sessions (id, user_id, session_name, started_at, completed_at)
       VALUES ($1, $2, 'Push', now() - interval '2 days', now() - interval '2 days' + interval '1 hour')`,
      [sid(1), TEST_USER_ID],
    )
    await repo.upsertWorkoutHrStats(TEST_USER_ID, sid(1), {
      avgBpm: 136, peakBpm: 172, hrr1Best: 28, workoutHrvMs: 44, readingsCount: 240, source: 'chest_strap',
    })
    const got = await repo.getWorkoutHrStats(TEST_USER_ID, sid(1))
    expect(got).toMatchObject({ avgBpm: 136, peakBpm: 172, hrr1Best: 28, workoutHrvMs: 44, readingsCount: 240, source: 'chest_strap' })
  })

  it('a partial (fewer-readings) recompute never clobbers a fuller snapshot', async () => {
    await repo.upsertWorkoutHrStats(TEST_USER_ID, sid(1), {
      avgBpm: 90, peakBpm: 100, hrr1Best: null, workoutHrvMs: null, readingsCount: 5, source: null,
    })
    const got = await repo.getWorkoutHrStats(TEST_USER_ID, sid(1))
    // 5 < 240 → the whole update is skipped; the fuller row stands.
    expect(got).toMatchObject({ avgBpm: 136, peakBpm: 172, workoutHrvMs: 44, readingsCount: 240 })
  })

  it('a fuller recompute wins and COALESCE keeps an old value the new one lost', async () => {
    // 260 >= 240 → update. workout_hrv_ms comes in null (rr pruned this pass) → COALESCE keeps 44.
    await repo.upsertWorkoutHrStats(TEST_USER_ID, sid(1), {
      avgBpm: 140, peakBpm: 178, hrr1Best: 30, workoutHrvMs: null, readingsCount: 260, source: 'chest_strap',
    })
    const got = await repo.getWorkoutHrStats(TEST_USER_ID, sid(1))
    expect(got).toMatchObject({ avgBpm: 140, peakBpm: 178, hrr1Best: 30, workoutHrvMs: 44, readingsCount: 260 })
  })

  // Every test above hands `workoutHrvMs` an integer (44) or null — which is why this shipped and
  // stayed broken. The real producer is `rmssdFromRr`, which returns `Math.sqrt(mean)`: a float
  // into an `integer` column, rejected by Postgres with `invalid input syntax for type integer`,
  // and swallowed by the caller's fire-and-forget .catch. Production ran at 0 rows in
  // workout_hr_stats across 66 completed sessions while its sibling set_hr_stats — same call site,
  // same block, no HRV column — held 582.
  it('accepts the fractional rMSSD its real producer emits', async () => {
    await pool.query(
      `INSERT INTO workout_sessions (id, user_id, session_name, started_at, completed_at)
       VALUES ($1, $2, 'Push', now() - interval '3 days', now() - interval '3 days' + interval '1 hour')`,
      [sid(4), TEST_USER_ID],
    )
    await repo.upsertWorkoutHrStats(TEST_USER_ID, sid(4), {
      avgBpm: 130, peakBpm: 170, hrr1Best: 25, workoutHrvMs: 38.42156862745098, readingsCount: 300, source: 'chest_strap',
    })
    const got = await repo.getWorkoutHrStats(TEST_USER_ID, sid(4))
    expect(got?.workoutHrvMs).toBe(38)
    await pool.query(`DELETE FROM workout_hr_stats WHERE workout_session_id = $1`, [sid(4)])
    await pool.query(`DELETE FROM workout_sessions WHERE id = $1`, [sid(4)])
  })

  it('lists completed sessions missing a snapshot, oldest-first, excluding ones already snapshotted', async () => {
    await pool.query(
      `INSERT INTO workout_sessions (id, user_id, session_name, started_at, completed_at) VALUES
       ($1, $3, 'Pull', now() - interval '5 days', now() - interval '5 days' + interval '1 hour'),
       ($2, $3, 'Legs', now() - interval '1 day',  now() - interval '1 day'  + interval '1 hour')`,
      [sid(2), sid(3), TEST_USER_ID],
    )
    const since = new Date(Date.now() - 180 * 86_400_000)
    const missing = await repo.listSessionsMissingHrStats(TEST_USER_ID, since, 10)
    const ids = missing.map(m => m.id)
    expect(ids).toEqual([sid(2), sid(3)]) // sid(1) has a snapshot; oldest (5d) before newest (1d)
  })

  it('respects the limit on the missing-list', async () => {
    const since = new Date(Date.now() - 180 * 86_400_000)
    const one = await repo.listSessionsMissingHrStats(TEST_USER_ID, since, 1)
    expect(one).toHaveLength(1)
    expect(one[0].id).toBe(sid(2)) // oldest first
  })

  it('Q-11 Defect B: a zero-reading snapshot stays on the missing-list, not just a missing row', async () => {
    // Simulates a completion-time compute that ran before the ring/strap data landed (see
    // app/api/complete-workout/route.ts): a real row gets written, but readings_count is 0. Before
    // the coverage-aware fix, any row at all — even an empty one — removed the session from this
    // list forever, so a later, fuller compute would never be attempted again.
    await pool.query(
      `INSERT INTO workout_sessions (id, user_id, session_name, started_at, completed_at)
       VALUES ($1, $2, 'Legs', now() - interval '6 days', now() - interval '6 days' + interval '1 hour')`,
      [sid(5), TEST_USER_ID],
    )
    const since = new Date(Date.now() - 180 * 86_400_000)
    const before = await repo.listSessionsMissingHrStats(TEST_USER_ID, since, 10)
    expect(before.map(m => m.id)).toContain(sid(5))

    await repo.upsertWorkoutHrStats(TEST_USER_ID, sid(5), {
      avgBpm: null, peakBpm: null, hrr1Best: null, workoutHrvMs: null, readingsCount: 0, source: null,
    })
    const stillMissing = await repo.listSessionsMissingHrStats(TEST_USER_ID, since, 10)
    expect(stillMissing.map(m => m.id)).toContain(sid(5))

    // A later, fuller compute clears it from the list again.
    await repo.upsertWorkoutHrStats(TEST_USER_ID, sid(5), {
      avgBpm: 130, peakBpm: 165, hrr1Best: 22, workoutHrvMs: 40, readingsCount: 180, source: 'oura_ble',
    })
    const afterFuller = await repo.listSessionsMissingHrStats(TEST_USER_ID, since, 10)
    expect(afterFuller.map(m => m.id)).not.toContain(sid(5))
  })
})
