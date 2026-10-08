// Issue 2716: the lbs-to-kg admin fix is a server write on a device-first table, so it has to travel
// the normal sync road. Apply moves `updated_at` on every converted log and each of its sets (the delta
// pull cursors both tables on their own `updated_at`), and a replayed push of the pre-conversion copy
// must not put the lbs-as-kg weights back (the push upsert is last-write-wins by arrival, with no
// `updated_at` comparison, so the converted log refuses the replay).
//
// DB-backed because both defects are in SQL. Not exercised: a real device pulling the rows.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-0000000027a1'
const LIFT = 'Unit Fix Sync Lift'
const OTHER_LIFT = 'Unit Fix Sync Untouched Lift'
const BEFORE = '2026-03-31'

describe.skipIf(!canRun)('lbs-to-kg Apply reaches devices (issue 2716)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let convertedLog = ''
  let convertedSet = ''
  let untouchedLog = ''
  let untouchedSet = ''
  let sessionId = ''
  let untouchedStamps: number[] = []
  let seededAt = 0 // the newest updated_at any seeded row carries

  async function seed(name: string, at: string, weight: number) {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1, 'S', $2) RETURNING id`, [USER, at])
    const el = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at, estimated_1rm, target_80, volume, exercise_deloaded)
       VALUES ($1, $2, $3, 150, 120, $4, false) RETURNING id`, [ws.rows[0].id, name, at, weight * 5])
    const sl = await pool.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1, 1, $2, 5) RETURNING id`, [el.rows[0].id, weight])
    return { ws: ws.rows[0].id as string, log: el.rows[0].id as string, set: sl.rows[0].id as string }
  }

  const stamp = async (table: 'exercise_logs' | 'set_logs', id: string) =>
    new Date((await pool.query(`SELECT updated_at FROM ${table} WHERE id = $1`, [id])).rows[0].updated_at).getTime()

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [USER, `unitfix-sync-${USER}@example.com`])
    const a = await seed(LIFT, '2026-01-10T00:00:00Z', 100)
    convertedLog = a.log; convertedSet = a.set; sessionId = a.ws
    const b = await seed(OTHER_LIFT, '2026-01-11T00:00:00Z', 100)
    untouchedLog = b.log; untouchedSet = b.set
    seededAt = Math.max(...await Promise.all([
      stamp('exercise_logs', convertedLog), stamp('set_logs', convertedSet),
      stamp('exercise_logs', untouchedLog), stamp('set_logs', untouchedSet),
    ]))
    untouchedStamps = [await stamp('exercise_logs', untouchedLog), await stamp('set_logs', untouchedSet)]
    await new Promise(r => setTimeout(r, 50))
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM personal_records WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('Apply moves updated_at on the converted log and its sets, and the delta pull returns them', async () => {
    await repo.applyLbsToKgFix(USER, [LIFT], BEFORE)
    expect(await stamp('exercise_logs', convertedLog)).toBeGreaterThan(seededAt)
    expect(await stamp('set_logs', convertedSet)).toBeGreaterThan(seededAt)

    // The same call the device's pull makes, from a cursor just after the seed.
    const delta = (await repo.getSyncDelta(USER, new Date(seededAt + 1))) as unknown as { exerciseLogs: { id: string }[]; setLogs: { id: string; weightKg: number }[] }
    const logIds = delta.exerciseLogs.map(l => l.id)
    const setIds = delta.setLogs.map(l => l.id)
    expect(logIds).toContain(convertedLog)
    expect(setIds).toContain(convertedSet)
    const pulled = delta.setLogs.find(l => l.id === convertedSet)!
    expect(pulled.weightKg).toBe(45.5) // 100 lbs-as-kg -> 45.36 -> nearest 0.5
  })

  it('leaves an unconverted log and its set exactly as they were', async () => {
    expect(await stamp('exercise_logs', untouchedLog)).toBe(untouchedStamps[0])
    expect(await stamp('set_logs', untouchedSet)).toBe(untouchedStamps[1])
    const delta = (await repo.getSyncDelta(USER, new Date(seededAt + 1))) as unknown as { exerciseLogs: { id: string }[]; setLogs: { id: string; weightKg: number }[] }
    expect(delta.exerciseLogs.map(l => l.id)).not.toContain(untouchedLog)
    expect(delta.setLogs.map(l => l.id)).not.toContain(untouchedSet)
  })

  it('an older pushed copy of a converted log does not put the lbs-as-kg weights back', async () => {
    const res = await repo.logExerciseAndSets(
      USER,
      {
        workoutSessionId: sessionId,
        exerciseLogId: convertedLog,
        exerciseName: LIFT,
        estimated1rm: 150,
        target80: 120,
        volume: 500,
        muscleGroups: ['chest'],
        loggedAt: new Date('2026-01-10T00:00:00Z'),
      } as never,
      [{ id: convertedSet, setNumber: 1, weightKg: 100, reps: 5, useFor1rm: true }] as never,
    )
    expect(res.exerciseLog.id).toBe(convertedLog)
    const w = await pool.query(`SELECT weight_kg FROM set_logs WHERE id = $1`, [convertedSet])
    expect(Number(w.rows[0].weight_kg)).toBe(45.5)
    const e = await pool.query(`SELECT estimated_1rm FROM exercise_logs WHERE id = $1`, [convertedLog])
    expect(Number(e.rows[0].estimated_1rm)).toBeLessThan(100)
  })

  it('a replayed push still updates a log the fix never touched (the guard is only for converted logs)', async () => {
    await repo.logExerciseAndSets(
      USER,
      {
        workoutSessionId: sessionId,
        exerciseLogId: untouchedLog,
        exerciseName: OTHER_LIFT,
        estimated1rm: 160,
        muscleGroups: ['chest'],
        loggedAt: new Date('2026-01-11T00:00:00Z'),
      } as never,
      [{ id: untouchedSet, setNumber: 1, weightKg: 102.5, reps: 5, useFor1rm: true }] as never,
    )
    const w = await pool.query(`SELECT weight_kg FROM set_logs WHERE id = $1`, [untouchedSet])
    expect(Number(w.rows[0].weight_kg)).toBe(102.5)
  })
})
