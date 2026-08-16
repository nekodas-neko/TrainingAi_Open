// Integration suite: the planned per-set snapshot (planned_pct / planned_rest_sec).
// Drives the real logExerciseFromPayload against a local dev Postgres — no repo mock —
// to prove the progressionStyle targets land on the set_logs row through the actual
// adapter insert + migration 126. Skips cleanly where there's no DATABASE_URL (CI's
// "Tests" job) so CI stays green.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const TEST_USER_ID = '00000000-0000-4000-8000-0000000005ec'

describe.skipIf(!canRun)('set_logs planned snapshot (migration 126)', () => {
  let pool: import('pg').Pool
  let logExerciseFromPayload: typeof import('@trainingai/shared/workout/log-exercise').logExerciseFromPayload

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    ;({ logExerciseFromPayload } = await import('@trainingai/shared/workout/log-exercise'))
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `planned-snapshot-${TEST_USER_ID}@example.com`],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    // FK cascades from workout_sessions clean up exercise_logs / set_logs.
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  async function readSets(exercise: string) {
    const { rows } = await pool.query(
      `SELECT sl.set_number, sl.intensity_pct, sl.planned_pct, sl.planned_reps, sl.rest_time_sec, sl.planned_rest_sec
         FROM set_logs sl
         JOIN exercise_logs el ON el.id = sl.exercise_log_id
         JOIN workout_sessions ws ON ws.id = el.workout_session_id
        WHERE ws.user_id = $1 AND el.exercise_name = $2
        ORDER BY sl.set_number`,
      [TEST_USER_ID, exercise],
    )
    return rows
  }

  it('snapshots the progression-style pct/rest onto each logged set', async () => {
    await logExerciseFromPayload(TEST_USER_ID, {
      sessionName: 'Snapshot Test',
      exercise: 'Snapshot Bench',
      weights: [100, 90],
      sets: 2,
      reps: [5, 8],
      progressionStyle: [
        { pct: 80, reps: 5, restSec: 180 },
        { pct: 70, reps: 8, restSec: 120 },
      ],
    }, 'Australia/Brisbane')

    const rows = await readSets('Snapshot Bench')
    expect(rows).toHaveLength(2)
    expect(Number(rows[0].planned_pct)).toBe(80)
    expect(rows[0].planned_rest_sec).toBe(180)
    expect(Number(rows[1].planned_pct)).toBe(70)
    expect(rows[1].planned_rest_sec).toBe(120)
    // The planned snapshot is distinct from the computed-actual intensity_pct.
    expect(rows[0].planned_pct).not.toBe(rows[0].intensity_pct)
  })

  it('leaves the planned columns NULL when the log carries no progression style', async () => {
    await logExerciseFromPayload(TEST_USER_ID, {
      sessionName: 'Snapshot Test',
      exercise: 'Freeform Curl',
      weights: [20],
      sets: 1,
      reps: [12],
    }, 'Australia/Brisbane')

    const rows = await readSets('Freeform Curl')
    expect(rows).toHaveLength(1)
    expect(rows[0].planned_pct).toBeNull()
    expect(rows[0].planned_reps).toBeNull()
    expect(rows[0].planned_rest_sec).toBeNull()
  })

  // Q-14: bodyweight movements carry no %1RM — the style's pct becomes a rep target
  // (resolveBodyweightStyle), so storing it as planned_pct made every such set read as a
  // 14-18 pp overshoot against a target that was never prescribed. Migration 153 adds
  // planned_reps and clears the historical percentages.
  it('records only the rep target for a bodyweight movement, never a planned pct', async () => {
    await pool.query(
      `INSERT INTO exercise_library (name, exercise_type) VALUES ('Snapshot Chin', 'bodyweight')
       ON CONFLICT (name) DO UPDATE SET exercise_type = 'bodyweight'`)

    await logExerciseFromPayload(TEST_USER_ID, {
      sessionName: 'Snapshot Test',
      exercise: 'Snapshot Chin',
      weights: [0, 0],
      sets: 2,
      reps: [6, 5],
      progressionStyle: [
        { pct: 75, reps: 7, restSec: 150 },
        { pct: 68, reps: 6, restSec: 150 },
      ],
    }, 'Australia/Brisbane')

    const rows = await readSets('Snapshot Chin')
    expect(rows).toHaveLength(2)
    expect(rows[0].planned_pct).toBeNull()
    expect(rows[1].planned_pct).toBeNull()
    expect(rows[0].planned_reps).toBe(7)
    expect(rows[1].planned_reps).toBe(6)
    // intensity_pct is still written — the load genuinely is BW_REF-relative.
    expect(rows[0].intensity_pct).not.toBeNull()
  })

  it('keeps planned_pct for a weighted lift and adds the rep target beside it', async () => {
    const rows = await readSets('Snapshot Bench')
    expect(rows[0].planned_reps).toBe(5)
    expect(rows[1].planned_reps).toBe(8)
  })
})
