// #3888 — a workout logged without a client `workoutSessionId`, with no open session of that name
// today, is created through `createWorkoutSession`. That branch stored neither `intensity_mode` nor
// `was_override`, so the row read back as "no override" whatever the lifter chose. This runs the real
// write path (`logExerciseWithRepo` → the Postgres adapter) and reads the stored row back.
//
// Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job; the CI-run twin is
// the create-branch case in `packages/shared/src/workout/__tests__/log-exercise.test.ts`.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003888'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('a session created without a client id stores the intensity choice (#3888)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool(); repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1,$2,'x') ON CONFLICT (id) DO NOTHING`,
      [USER, `s3888-${USER}@example.com`])
  })
  afterAll(async () => {
    await pool.query('DELETE FROM workout_sessions WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM users WHERE id=$1', [USER])
  })

  const row = async (id: string) => (await pool.query(
    'SELECT intensity_mode, was_override FROM workout_sessions WHERE id=$1 AND user_id=$2', [id, USER])).rows[0]

  it.each([
    ['Full, overridden', 'full', true],
    ['Deload, overridden', 'deload', true],
    ['Deload, as planned', 'deload', false],
  ] as const)('%s', async (label, intensityMode, wasOverride) => {
    const { logExerciseWithRepo } = await import('@trainingai/shared/workout/log-exercise-core')
    const result = await logExerciseWithRepo(repo, USER, {
      sessionName: `3888 ${label}`,
      exercise: 'Bench Press',
      weights: [60],
      sets: 1,
      reps: [5],
      intensityMode,
      wasOverride,
    }, TZ)
    expect(await row(result.workoutSessionId)).toEqual({ intensity_mode: intensityMode, was_override: wasOverride })
  })

  it('the adapter stores both fields when called directly, and defaults to none', async () => {
    const withChoice = await repo.createWorkoutSession(USER, undefined, '3888 direct', new Date(), undefined, undefined, false, 'full', true)
    expect(withChoice).toMatchObject({ intensityMode: 'full', wasOverride: true })
    expect(await row(withChoice.id)).toEqual({ intensity_mode: 'full', was_override: true })

    const legacy = await repo.createWorkoutSession(USER, undefined, '3888 legacy', new Date())
    expect(await row(legacy.id)).toEqual({ intensity_mode: null, was_override: false })
  })
})
