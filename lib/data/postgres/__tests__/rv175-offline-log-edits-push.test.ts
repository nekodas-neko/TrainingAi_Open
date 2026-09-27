// RV-175 — editing or deleting a logged exercise, or deleting a session, had no outbox domain, so
// offline it toasted success, then failed, and was lost. These drive the three new push branches
// through `pushMutations` against a real database, and check they reach the SAME writes the web
// routes make (`lib/workout/exercise-log-edits.ts`, `lib/workout/delete-session.ts`).
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000175001'
const OTHER = '00000000-0000-4000-8000-000000175002'
const DATE = '2026-09-20'

describe.skipIf(!canRun)('offline edits and deletes of logged work reach the server (RV-175)', () => {
  let pool: import('pg').Pool
  let repo: Awaited<ReturnType<typeof import('@/lib/data')['getRepository']>>
  let sessionId: string
  let logId: string
  let otherLogId: string

  async function seedSession(userId: string, name: string): Promise<{ sessionId: string; logId: string }> {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'RV175', now() - interval '2 hours', now() - interval '1 hour') RETURNING id`, [userId])
    const el = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at) VALUES ($1, $2, now() - interval '90 minutes') RETURNING id`,
      [ws.rows[0].id, name])
    for (const n of [1, 2]) {
      await pool.query(`INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1, $2, 40, 8)`, [el.rows[0].id, n])
    }
    return { sessionId: ws.rows[0].id, logId: el.rows[0].id }
  }

  const push = (domain: string, payload: Record<string, unknown>, userId = USER) =>
    repo.pushMutations(userId, [{ id: `m-${domain}-${Math.random()}`, domain, date: DATE, payload } as never])

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const [id, tag] of [[USER, 'mine'], [OTHER, 'other']]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `rv175-${tag}@example.com`])
    }
  })

  beforeEach(async () => {
    for (const id of [USER, OTHER]) await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [id])
    ;({ sessionId, logId } = await seedSession(USER, 'RV175 Bench'))
    ;({ logId: otherLogId } = await seedSession(OTHER, 'RV175 Bench'))
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM personal_records WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  const liveSets = async (id: string) => (await pool.query(
    `SELECT set_number, weight_kg, reps FROM set_logs WHERE exercise_log_id = $1 AND deleted_at IS NULL ORDER BY set_number`, [id])).rows

  it('exercise_log_edit rewrites the sets, adds one, and recomputes the log', async () => {
    const res = await push('exercise_log_edit', { exerciseLogId: logId, weights: [50, 50, 55], reps: [5, 5, 3] })
    expect(res.errors).toEqual([])
    expect(await liveSets(logId)).toEqual([
      { set_number: 1, weight_kg: 50, reps: 5 }, { set_number: 2, weight_kg: 50, reps: 5 }, { set_number: 3, weight_kg: 55, reps: 3 },
    ])
    const log = (await pool.query(`SELECT volume, estimated_1rm FROM exercise_logs WHERE id = $1`, [logId])).rows[0]
    expect(Number(log.volume)).toBe(50 * 5 + 50 * 5 + 55 * 3)
    expect(Number(log.estimated_1rm)).toBeGreaterThan(0)
  })

  it('exercise_log_edit on a log that is not there goes to errors, so the client retries it', async () => {
    const res = await push('exercise_log_edit', { exerciseLogId: '00000000-0000-4000-8000-0000001759ff', weights: [50], reps: [5] })
    expect(res.errors.map(e => e.error)).toEqual(['No matching exercise log for exercise_log_edit'])
  })

  it('exercise_log_edit cannot touch another user’s log', async () => {
    const res = await push('exercise_log_edit', { exerciseLogId: otherLogId, weights: [99], reps: [1] })
    expect(res.errors).toHaveLength(1)
    expect(await liveSets(otherLogId)).toEqual([
      { set_number: 1, weight_kg: 40, reps: 8 }, { set_number: 2, weight_kg: 40, reps: 8 },
    ])
  })

  it('exercise_log_delete tombstones the log, and its last exercise takes the session with it', async () => {
    const res = await push('exercise_log_delete', { exerciseLogId: logId })
    expect(res.errors).toEqual([])
    expect((await pool.query(`SELECT deleted_at FROM exercise_logs WHERE id = $1`, [logId])).rows[0].deleted_at).not.toBeNull()
    expect((await pool.query(`SELECT deleted_at FROM workout_sessions WHERE id = $1`, [sessionId])).rows[0].deleted_at).not.toBeNull()
  })

  it('a replayed exercise_log_delete is not an error, and another user’s log survives one', async () => {
    await push('exercise_log_delete', { exerciseLogId: logId })
    const replay = await push('exercise_log_delete', { exerciseLogId: logId })
    expect(replay.errors).toEqual([])
    await push('exercise_log_delete', { exerciseLogId: otherLogId })
    expect((await pool.query(`SELECT deleted_at FROM exercise_logs WHERE id = $1`, [otherLogId])).rows[0].deleted_at).toBeNull()
  })

  it('workout_session_delete tombstones the session and its logs, and replays cleanly', async () => {
    const res = await push('workout_session_delete', { workoutSessionId: sessionId })
    expect(res.errors).toEqual([])
    expect((await pool.query(`SELECT deleted_at FROM workout_sessions WHERE id = $1`, [sessionId])).rows[0].deleted_at).not.toBeNull()
    expect(await liveSets(logId)).toEqual([])
    expect((await push('workout_session_delete', { workoutSessionId: sessionId })).errors).toEqual([])
  })

  it('workout_session_delete re-derives the PR the deleted session held, as the web route does', async () => {
    // The reconcile used to live only in the route, so an outbox delete would have left a PR
    // standing on a session that no longer exists.
    await pool.query(`UPDATE exercise_logs SET estimated_1rm = 90 WHERE id = $1`, [logId])
    await pool.query(
      `INSERT INTO personal_records (user_id, exercise_name, estimated_1rm) VALUES ($1, 'RV175 Bench', 90)`, [USER])
    await push('workout_session_delete', { workoutSessionId: sessionId })
    const pr = await pool.query(`SELECT 1 FROM personal_records WHERE user_id = $1 AND exercise_name = 'RV175 Bench'`, [USER])
    expect(pr.rowCount).toBe(0)
  })

  it('rejects a malformed payload for each domain rather than guessing', async () => {
    for (const [domain, payload] of [
      ['exercise_log_edit', { exerciseLogId: logId, weights: [50] }],
      ['exercise_log_delete', { exerciseLogId: 'not-a-uuid' }],
      ['workout_session_delete', { workoutSessionId: sessionId, extra: 1 }],
    ] as const) {
      const res = await push(domain, payload as Record<string, unknown>)
      expect(res.errors.map(e => e.error)).toEqual([`Invalid ${domain} payload`])
    }
  })
})
