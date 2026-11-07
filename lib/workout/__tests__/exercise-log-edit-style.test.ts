// Integration suite, issue 3663: an edit re-scores a log against the style it was scored with when
// it was written. Drives the real log path (`logExerciseFromPayload`) and the real edit
// (`editExerciseLog`) against a local dev Postgres, for a Preview log (no style id) and a
// current-app log (the static style's id, with the AI's different percentages in the payload).
// Skips where there's no DATABASE_URL (CI's "Tests" job); the pure rebuild is covered in CI by
// packages/shared/src/workout/__tests__/logged-style.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const TEST_USER_ID = '00000000-0000-4000-8000-000000003663'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('editExerciseLog keeps the logged style (issue 3663)', () => {
  let pool: import('pg').Pool
  let logExerciseFromPayload: typeof import('@trainingai/shared/workout/log-exercise').logExerciseFromPayload
  let editExerciseLog: typeof import('../exercise-log-edits').editExerciseLog

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    ;({ logExerciseFromPayload } = await import('@trainingai/shared/workout/log-exercise'))
    ;({ editExerciseLog } = await import('../exercise-log-edits'))
    pool = getPool()
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)`,
      [TEST_USER_ID, `edit-style-${TEST_USER_ID}@example.com`, TZ],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  async function stored1rm(exerciseLogId: string): Promise<number> {
    const { rows } = await pool.query(`SELECT estimated_1rm FROM exercise_logs WHERE id = $1`, [exerciseLogId])
    return Number(rows[0].estimated_1rm)
  }

  it('a Preview log (no style id) re-scores to the same 1RM after an unchanged edit', async () => {
    const logged = await logExerciseFromPayload(TEST_USER_ID, {
      sessionName: 'Edit Style Test',
      exercise: 'Edit Style Squat',
      weights: [70, 70, 70, 70],
      reps: [8, 8, 8, 8],
      sets: 4,
      progressionStyle: Array.from({ length: 4 }, () => ({ pct: 70, reps: 8, restSec: 120, useFor1rm: true })),
      plannedWeights: [70, 70, 70, 70],
      prescriptionBasisKg: 100,
    }, TZ)
    expect(logged.estimated1rm).toBe(100)

    // Before the fix this re-scored with no style: 87.75.
    const res = await editExerciseLog(TEST_USER_ID, {
      exerciseLogId: logged.exerciseLogId, weights: [70, 70, 70, 70], reps: [8, 8, 8, 8],
    })
    expect(res).toEqual({ found: true, superseded: false })
    expect(await stored1rm(logged.exerciseLogId)).toBe(100)

    // A real correction moves the estimate by the rep, not by the lost style.
    await editExerciseLog(TEST_USER_ID, {
      exerciseLogId: logged.exerciseLogId, weights: [70, 70, 70, 70], reps: [8, 8, 8, 9],
    })
    const corrected = await stored1rm(logged.exerciseLogId)
    expect(corrected).toBeGreaterThan(100)
    expect(corrected).toBeLessThan(103)
  })

  it('a current-app log re-scores against the prescribed percentages, not its static style', async () => {
    const { rows: [style] } = await pool.query(
      `INSERT INTO progression_styles (user_id, name) VALUES ($1, 'Edit Style 5x5') RETURNING id`,
      [TEST_USER_ID],
    )
    await pool.query(
      `INSERT INTO style_sets (style_id, set_number, pct, reps, rest_sec, use_for_1rm)
       SELECT $1, n, 85, 5, 180, true FROM generate_series(1, 3) AS n`,
      [style.id],
    )
    const logged = await logExerciseFromPayload(TEST_USER_ID, {
      sessionName: 'Edit Style Test',
      exercise: 'Edit Style Bench',
      weights: [90, 90, 90],
      reps: [6, 6, 6],
      sets: 3,
      styleId: style.id,
      styleName: 'AI · Accumulation',
      progressionStyle: Array.from({ length: 3 }, () => ({ pct: 75, reps: 6, restSec: 150, useFor1rm: true })),
      plannedWeights: [90, 90, 90],
      prescriptionBasisKg: 120,
    }, TZ)
    expect(logged.estimated1rm).toBe(120)
    const { rows: [el] } = await pool.query(`SELECT style_id FROM exercise_logs WHERE id = $1`, [logged.exerciseLogId])
    expect(el.style_id).toBe(style.id)

    await editExerciseLog(TEST_USER_ID, {
      exerciseLogId: logged.exerciseLogId, weights: [90, 90, 90], reps: [6, 6, 6],
    })
    expect(await stored1rm(logged.exerciseLogId)).toBe(120)
  })

  it('a log from before the planned columns still re-scores against its style id', async () => {
    const { rows: [style] } = await pool.query(
      `INSERT INTO progression_styles (user_id, name) VALUES ($1, 'Edit Style Legacy') RETURNING id`,
      [TEST_USER_ID],
    )
    await pool.query(
      `INSERT INTO style_sets (style_id, set_number, pct, reps, rest_sec, use_for_1rm)
       SELECT $1, n, 70, 8, 120, true FROM generate_series(1, 2) AS n`,
      [style.id],
    )
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1, 'Edit Style Legacy', now()) RETURNING id`,
      [TEST_USER_ID],
    )
    const { rows: [el] } = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, style_id, estimated_1rm, logged_at)
       VALUES ($1, 'Edit Style Legacy Row', $2, 0, now()) RETURNING id`,
      [ws.id, style.id],
    )
    await pool.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1, 1, 70, 8), ($1, 2, 70, 8)`,
      [el.id],
    )
    await editExerciseLog(TEST_USER_ID, { exerciseLogId: el.id, weights: [70, 70], reps: [8, 8] })
    expect(await stored1rm(el.id)).toBe(100)
  })
})
