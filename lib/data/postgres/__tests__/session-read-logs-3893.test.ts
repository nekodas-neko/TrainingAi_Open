// #3893: the session read's loader on a real Postgres (skips without DATABASE_URL). It reads the
// user's own workouts in [from, to), leaves deleted rows out, carries the rest after each set, the
// effort answer and the per-set and workout heart-rate fields, and writes nothing.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003893'
const OTHER = '00000000-0000-4000-8000-000000003894'

describe.skipIf(!canRun)('getSessionReadLogs (#3893)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const inside = randomUUID()
  const outside = randomUUID()
  const deletedLog = randomUUID()
  const otherUser = randomUUID()
  const bench = randomUUID()
  const sets = [randomUUID(), randomUUID()]

  async function workout(id: string, user: string, startedAt: string) {
    await pool.query(
      `INSERT INTO workout_sessions (id, user_id, session_name, started_at, completed_at, was_override, phase_type)
       VALUES ($1, $2, 'Read Test', $3, $3::timestamptz + interval '1 hour', false, 'normal')`,
      [id, user, startedAt],
    )
  }
  async function exerciseLog(id: string, ws: string, deleted = false) {
    await pool.query(
      `INSERT INTO exercise_logs (id, workout_session_id, exercise_name, estimated_1rm, logged_at, effort_vs_plan, effort_source, deleted_at)
       VALUES ($1, $2, 'Read Bench', 100, now(), 1, 'tapped', ${deleted ? 'now()' : 'NULL'})`,
      [id, ws],
    )
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const u of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'UTC') ON CONFLICT (id) DO NOTHING`,
        [u, `read-${u}@example.com`],
      )
    }
    await workout(inside, USER, '2026-11-10T08:00:00Z')
    await workout(outside, USER, '2026-11-20T08:00:00Z')
    await workout(otherUser, OTHER, '2026-11-10T08:00:00Z')
    await exerciseLog(bench, inside)
    await exerciseLog(deletedLog, inside, true)
    await exerciseLog(randomUUID(), outside)
    await exerciseLog(randomUUID(), otherUser)
    for (const [i, id] of sets.entries()) {
      await pool.query(
        `INSERT INTO set_logs (id, exercise_log_id, set_number, weight_kg, reps, rest_time_sec, planned_rest_sec, planned_reps, planned_weight_kg, planned_pct, rpe, rpe_source)
         VALUES ($1, $2, $3, 80, $4, $5, 120, 8, 80, 80, 8, 'rated')`,
        [id, bench, i + 1, i === 0 ? 8 : 6, i === 0 ? 48 : 90],
      )
    }
    await pool.query(
      `INSERT INTO set_hr_stats (set_log_id, user_id, workout_session_id, exercise_name, set_number, recovered_preset, rest_adequate, coverage_ok)
       VALUES ($1, $2, $3, 'Read Bench', 1, false, true, true)`,
      [sets[0], USER, inside],
    )
    await pool.query(
      `INSERT INTO workout_hr_stats (workout_session_id, user_id, hr_dense) VALUES ($1, $2, true)`,
      [inside, USER],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]])
  })

  it('reads only the user\'s own, undeleted logs of workouts started in the range', async () => {
    const logs = await repo.getSessionReadLogs(USER, new Date('2026-11-09T00:00:00Z'), new Date('2026-11-20T08:00:00Z'))
    expect(logs.map(l => l.exerciseLogId)).toEqual([bench])
  })

  it('carries the fields the read needs, with the rest after each set and its heart rate', async () => {
    const [log] = await repo.getSessionReadLogs(USER, new Date('2026-11-09T00:00:00Z'), new Date('2026-11-11T00:00:00Z'))
    expect(log).toMatchObject({
      workoutSessionId: inside, exerciseName: 'Read Bench', estimated1rm: 100, exerciseDeloaded: false,
      effortVsPlan: 1, effortSource: 'tapped',
      session: { completed: true, wasOverride: false, isEarlyDeload: false, phaseType: 'normal', hrDense: true },
    })
    expect(log.sets).toEqual([
      expect.objectContaining({ setNumber: 1, reps: 8, restTimeSec: 48, plannedRestSec: 120, plannedReps: 8, plannedWeightKg: 80, plannedPct: 80, rpe: 8, rpeSource: 'rated', hr: { recoveredPreset: false, restAdequate: true, coverageOk: true } }),
      expect.objectContaining({ setNumber: 2, reps: 6, restTimeSec: 90, hr: null }),
    ])
  })
})
