// The seven soft-delete filters in `reconcileUserStats` (Q-182, user-stats slice).
//
// This function exists to self-heal a counter that drifts — `user_stats` is incremented on write
// and never decremented on delete, so a tombstoned session or set permanently inflates lifetime
// totals and then mis-gates XP and achievements. Its whole job is to notice deletes. Until now,
// **removing any of its `deleted_at IS NULL` filters failed no test at all**.
//
// Each case deletes at exactly ONE level, so a filter that stops working is attributable rather
// than merely detectable. Verified by mutation: rewriting each filter to `1 = 1` fails the case
// named beside it below.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000e001'

describe.skipIf(!canRun)('reconcileUserStats — soft-delete filters', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let reconcileUserStats: typeof import('@/lib/data/postgres/slices/user-stats').reconcileUserStats
  let sessionId = ''
  let exerciseLogId = ''
  let setIds: string[] = []

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool(); db = client.getDb()
    ;({ reconcileUserStats } = await import('@/lib/data/postgres/slices/user-stats'))
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'user-stats-sd@example.com', 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM user_stats WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM user_stats WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])

    // One COMPLETED session — the function counts finished workouts only (Q-8).
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'SD Test', now() - interval '2 hours', now() - interval '1 hour') RETURNING id`, [USER])
    sessionId = ws.id
    const { rows: [el] } = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, logged_at)
       VALUES ($1, 'SD Bench', 100, now()) RETURNING id`, [sessionId])
    exerciseLogId = el.id
    const { rows } = await pool.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps)
       VALUES ($1, 1, 50, 5), ($1, 2, 50, 5) RETURNING id`, [exerciseLogId])
    setIds = rows.map(r => r.id)
  })

  async function totals() {
    await reconcileUserStats(db, USER)
    const { rows } = await pool.query(
      `SELECT total_sessions, total_volume_kg, total_sets FROM user_stats WHERE user_id = $1`, [USER])
    return {
      sessions: Number(rows[0]?.total_sessions ?? 0),
      volume: Number(rows[0]?.total_volume_kg ?? 0),
      sets: Number(rows[0]?.total_sets ?? 0),
    }
  }

  it('derives the totals from live rows', async () => {
    expect(await totals()).toEqual({ sessions: 1, volume: 100, sets: 2 })
  })

  it('drops a deleted SET from the set count, and leaves the others alone (sl.deleted_at)', async () => {
    await pool.query(`UPDATE set_logs SET deleted_at = now() WHERE id = $1`, [setIds[0]])
    // Only the set count moves: a deleted set is not a deleted exercise or session.
    expect(await totals()).toEqual({ sessions: 1, volume: 100, sets: 1 })
  })

  it('drops a deleted EXERCISE LOG from all three totals (el.deleted_at ×3)', async () => {
    await pool.query(`UPDATE exercise_logs SET deleted_at = now() WHERE id = $1`, [exerciseLogId])
    // Its volume goes, its sets go, and the session no longer has a live log to be counted by.
    expect(await totals()).toEqual({ sessions: 0, volume: 0, sets: 0 })
  })

  it('drops a deleted SESSION from all three totals (ws.deleted_at ×3)', async () => {
    await pool.query(`UPDATE workout_sessions SET deleted_at = now() WHERE id = $1`, [sessionId])
    expect(await totals()).toEqual({ sessions: 0, volume: 0, sets: 0 })
  })

  it('corrects a counter that was already inflated, rather than only writing on first run', async () => {
    // The drift this function exists for: the stored counter is high, nothing about the source rows
    // changed, and reconciling must bring it down.
    await totals()
    await pool.query(
      `UPDATE user_stats SET total_sessions = 99, total_volume_kg = 9999, total_sets = 99 WHERE user_id = $1`,
      [USER])
    expect(await totals()).toEqual({ sessions: 1, volume: 100, sets: 2 })
  })
})
