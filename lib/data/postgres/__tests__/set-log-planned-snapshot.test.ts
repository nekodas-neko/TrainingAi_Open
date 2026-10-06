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
      `SELECT sl.set_number, sl.intensity_pct, sl.planned_pct, sl.planned_reps, sl.rest_time_sec, sl.planned_rest_sec,
              sl.planned_weight_kg, sl.rpe, sl.rpe_source
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

  // #2445: the bar the app put up after plate rounding, not the pct's arithmetic. The Skull Crusher
  // case from #2200: 36.5 x 70.5% = 25.73, rounded UP to 27.5 on a 2.5 kg step.
  it('stores the prescribed bar per set, null where no bar was prescribed', async () => {
    await logExerciseFromPayload(TEST_USER_ID, {
      sessionName: 'Snapshot Test',
      exercise: 'Snapshot Skull Crusher',
      weights: [27.5, 27.5, 25],
      sets: 3,
      reps: [10, 10, 12],
      progressionStyle: [
        { pct: 70.5, reps: 10, restSec: 90 },
        { pct: 70.5, reps: 10, restSec: 90 },
      ],
      plannedWeights: [27.5, 27.5, null],
    }, 'Australia/Brisbane')

    const rows = await readSets('Snapshot Skull Crusher')
    expect(rows.map(r => r.planned_weight_kg)).toEqual([27.5, 27.5, null])
  })

  it('leaves planned_weight_kg NULL on a log that sends none, as every pre-#2445 row is', async () => {
    const rows = await readSets('Snapshot Bench')
    expect(rows.map(r => r.planned_weight_kg)).toEqual([null, null])
  })

  it('never stores a bar for a bodyweight movement, even if one is sent', async () => {
    await logExerciseFromPayload(TEST_USER_ID, {
      sessionName: 'Snapshot Test',
      exercise: 'Snapshot Chin',
      weights: [0],
      sets: 1,
      reps: [6],
      progressionStyle: [{ pct: 75, reps: 7, restSec: 150 }],
      plannedWeights: [40],
    }, 'Australia/Brisbane')

    const rows = await readSets('Snapshot Chin')
    expect(rows.every(r => r.planned_weight_kg === null)).toBe(true)
  })

  // #2450: whether each RPE was tapped on the picker or left at its pre-fill.
  it('stores rpe_source beside each RPE, and none on a set without one', async () => {
    await logExerciseFromPayload(TEST_USER_ID, {
      sessionName: 'Snapshot Test',
      exercise: 'Snapshot Row',
      weights: [60, 60, 60],
      sets: 3,
      reps: [8, 8, 8],
      rpeValues: [7, 9],
      rpeSources: ['expected', 'rated', 'rated'],
    }, 'Australia/Brisbane')

    const rows = await readSets('Snapshot Row')
    expect(rows.map(r => [r.rpe, r.rpe_source])).toEqual([[7, 'expected'], [9, 'rated'], [null, null]])
  })

  it('leaves rpe_source NULL on a log that sends none, as every pre-#2450 row is', async () => {
    const rows = await readSets('Snapshot Bench')
    expect(rows.map(r => r.rpe_source)).toEqual([null, null])
  })

  it('rejects any other value at the column, not just at the payload schema', async () => {
    const { rows: [set] } = await pool.query(
      `SELECT sl.id FROM set_logs sl JOIN exercise_logs el ON el.id = sl.exercise_log_id
        JOIN workout_sessions ws ON ws.id = el.workout_session_id
        WHERE ws.user_id = $1 AND el.exercise_name = 'Snapshot Row' LIMIT 1`, [TEST_USER_ID])
    await expect(pool.query(`UPDATE set_logs SET rpe_source = 'guessed' WHERE id = $1`, [set.id]))
      .rejects.toThrow(/rpe_source/)
  })
})
