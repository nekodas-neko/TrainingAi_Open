// #3745: the after-the-last-set answer, end to end on a real Postgres (skips without DATABASE_URL).
//
// The upload stores it on exercise_logs; a replay from an OLDER BUILD (no `effort` key) or any
// re-push that carries no answer keeps the stored pair rather than nulling it (the class of bug
// LA-137 guards on the pull side); a newer answer replaces both halves; and the sync pull another
// device reads carries it back down.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003745'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('exercise_logs effort_vs_plan through the upload (#3745)', () => {
  let pool: import('pg').Pool
  let logExerciseFromPayload: typeof import('@trainingai/shared/workout/log-exercise').logExerciseFromPayload

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    ;({ logExerciseFromPayload } = await import('@trainingai/shared/workout/log-exercise'))
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [USER, `effort-${USER}@example.com`, TZ],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  const ids = () => ({ workoutSessionId: randomUUID(), exerciseLogId: randomUUID(), setLogIds: [randomUUID(), randomUUID()] })
  const payload = (id: ReturnType<typeof ids>, extra: Record<string, unknown> = {}) => ({
    sessionName: 'Effort Test',
    exercise: 'Effort Bench',
    weights: [60, 60],
    sets: 2,
    reps: [8, 8],
    rpeValues: [7, 7],
    rpeSources: ['expected', 'expected'] as ('expected' | 'rated')[],
    ...id,
    ...extra,
  })
  async function stored(exerciseLogId: string) {
    const { rows } = await pool.query(
      `SELECT effort_vs_plan, effort_source FROM exercise_logs WHERE id = $1`,
      [exerciseLogId],
    )
    return rows[0] as { effort_vs_plan: number | null; effort_source: string | null }
  }

  it('stores a tapped answer and its source', async () => {
    const id = ids()
    await logExerciseFromPayload(USER, payload(id, { effort: { vsPlan: -1, source: 'tapped' } }), TZ)
    expect(await stored(id.exerciseLogId)).toEqual({ effort_vs_plan: -1, effort_source: 'tapped' })
  })

  it('an older build logs with no answer: both columns NULL', async () => {
    const id = ids()
    await logExerciseFromPayload(USER, payload(id), TZ)
    expect(await stored(id.exerciseLogId)).toEqual({ effort_vs_plan: null, effort_source: null })
  })

  it('a replay without an answer keeps the stored one; a newer answer replaces both halves', async () => {
    const id = ids()
    await logExerciseFromPayload(USER, payload(id, { effort: { vsPlan: 1, source: 'tapped' } }), TZ)
    // The same exercise log, re-pushed by a build (or a store) that never held the answer.
    await logExerciseFromPayload(USER, payload(id, { reps: [8, 7] }), TZ)
    expect(await stored(id.exerciseLogId)).toEqual({ effort_vs_plan: 1, effort_source: 'tapped' })
    await logExerciseFromPayload(USER, payload(id, { effort: { vsPlan: 0, source: 'default' } }), TZ)
    expect(await stored(id.exerciseLogId)).toEqual({ effort_vs_plan: 0, effort_source: 'default' })
  })

  it('leaves the per-set effort exactly as sent', async () => {
    const id = ids()
    await logExerciseFromPayload(USER, payload(id, { effort: { vsPlan: 1, source: 'tapped' } }), TZ)
    const { rows } = await pool.query(
      `SELECT rpe, rpe_source FROM set_logs WHERE exercise_log_id = $1 ORDER BY set_number`,
      [id.exerciseLogId],
    )
    expect(rows).toEqual([{ rpe: 7, rpe_source: 'expected' }, { rpe: 7, rpe_source: 'expected' }])
  })

  it('comes back down in the sync pull another device reads', async () => {
    const id = ids()
    await logExerciseFromPayload(USER, payload(id, { effort: { vsPlan: 1, source: 'default' } }), TZ)
    const { getRepository } = await import('@/lib/data')
    const repo = await getRepository()
    const delta = await repo.getSyncDelta(USER, new Date(0), null)
    const row = (delta.exerciseLogs as unknown as Record<string, unknown>[]).find(r => r.id === id.exerciseLogId)
    expect(row).toMatchObject({ effortVsPlan: 1, effortSource: 'default' })
  })
})
