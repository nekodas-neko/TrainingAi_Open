// #4080 review: a weekly check-in save that times out waiting for a lift's lock fails as a whole, with the
// check-in's own 409 refusal, and writes nothing. The save is one transaction, and the lowering is applied
// through the Coach's writer inside it, so a lock wait there must not leave the days off, the check-in row
// or the held lift behind. Real Postgres only (DATABASE_URL). Fake user and lifts, all removed afterwards.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr, todayInTz, weekStartForDay } from '@trainingai/shared/date-utils'

const reportServerError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/observability', () => ({ reportServerError }))

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const U = '00000000-0000-4000-8000-0000040800a1'
const SQ = 'Checkin Squat 4080'
const BP = 'Checkin Press 4080'

const W0 = shiftDateStr(weekStartForDay(todayInTz(TZ)), -7)
const local = (dayOffset: number, hour: number) => new Date(dateStrMidnightInTz(shiftDateStr(W0, dayOffset), TZ).getTime() + hour * 3_600_000)
const NOW = local(2, 18)

describe.skipIf(!canRun)('weekly check-in save, lock wait (#4080)', () => {
  let pool: import('pg').Pool
  let engine: typeof import('@/lib/weekly-checkin/engine')
  let lockWait: typeof import('@/lib/coach/lock-wait').lockWait
  let was: number
  let ctx: import('@/lib/weekly-checkin/engine').EngineCtx
  const ids = {} as Record<string, string>

  const seed = async () => {
    const program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, created_at) VALUES ($1,'Checkin lock test','ai_dynamic',true,'strength', now() - interval '90 days') RETURNING id`, [U])).rows[0].id
    const session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Day 4080',0) RETURNING id`, [program])).rows[0].id
    const schedule = (await pool.query(`INSERT INTO schedules (program_id, type) VALUES ($1,'weekly') RETURNING id`, [program])).rows[0].id
    for (const day of [0, 1, 2]) await pool.query(`INSERT INTO schedule_days (schedule_id, day_of_week, session_id) VALUES ($1,$2,$3)`, [schedule, day, session])
    const ex = async (name: string, pos: number) =>
      (await pool.query(`INSERT INTO session_exercises (session_id, exercise_name, exercise_id, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,$4,'primary',$5) RETURNING id`,
        [session, name, ids[`lib:${name}`], pos, name === SQ ? ['quadriceps'] : ['chest']])).rows[0].id as string
    ids.sq = await ex(SQ, 0)
    ids.bp = await ex(BP, 1)
    for (const [name, rm] of [[SQ, 140], [BP, 100]] as const) {
      await pool.query(`INSERT INTO exercise_estimates (user_id, exercise_name, exercise_id, estimated_1rm) VALUES ($1,$2,$3,$4)`, [U, name, ids[`lib:${name}`], rm])
    }
    for (let d = 0; d < 3; d++) {
      const ws = (await pool.query(
        `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Day 4080',$3,$4) RETURNING id`,
        [U, session, local(d, 12), local(d, 13)])).rows[0].id
      for (const name of [SQ, BP]) {
        const el = (await pool.query(
          `INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, estimated_1rm, logged_at) VALUES ($1,$2,$3,100,$4) RETURNING id`,
          [ws, name, ids[`lib:${name}`], local(d, 12.5)])).rows[0].id
        for (let n = 1; n <= 3; n++) {
          const miss = name === SQ && d === 2 && n === 2 // the squat's last session falls short: Heavy lowers one step
          await pool.query(
            `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, planned_reps, planned_weight_kg, planned_pct, rest_time_sec, planned_rest_sec)
             VALUES ($1,$2,80,$3,5,80,75,150,150)`, [el, n, miss ? 3 : 5])
        }
      }
    }
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    engine = await import('@/lib/weekly-checkin/engine')
    lockWait = (await import('@/lib/coach/lock-wait')).lockWait
    was = lockWait.ms
    lockWait.ms = 300
    const repo = await (await import('@/lib/data')).getRepositoryAsync()
    ctx = { db: client.getDb(), repo, userId: U, tz: TZ, now: NOW }
    await pool.query(`DELETE FROM exercise_library WHERE name = ANY($1)`, [[SQ, BP]])
    for (const [name, muscle] of [[SQ, 'quads'], [BP, 'chest']]) {
      ids[`lib:${name}`] = (await pool.query(
        `INSERT INTO exercise_library (name, equipment, muscles) VALUES ($1, ARRAY['barbell'], $2::jsonb)
         ON CONFLICT (name) DO UPDATE SET equipment = EXCLUDED.equipment, muscles = EXCLUDED.muscles RETURNING id`,
        [name, JSON.stringify([{ muscle, role: 'main' }])])).rows[0].id
    }
  })

  afterAll(async () => {
    if (lockWait) lockWait.ms = was
    await pool?.query(`DELETE FROM users WHERE id = $1`, [U])
    await pool?.query(`DELETE FROM exercise_library WHERE name = ANY($1)`, [[SQ, BP]])
  })

  beforeEach(async () => {
    reportServerError.mockClear()
    await pool.query(`DELETE FROM users WHERE id = $1`, [U])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [U, `weekly-checkin-4080-${U}@example.com`, TZ])
    await seed()
  })

  const save = () => engine.saveCheckin(ctx, {
    weekStart: W0,
    lifts: [{ sessionExerciseId: ids.sq, answer: 'heavy' }, { sessionExerciseId: ids.bp, answer: 'light' }],
    pain: null,
    swap: null,
    daysOff: [3, 6],
    shorterSessionMin: 40,
  })
  const written = async () => ({
    checkins: (await pool.query(`SELECT count(*)::int AS n FROM weekly_checkins WHERE user_id = $1`, [U])).rows[0].n as number,
    liftRows: (await pool.query(`SELECT count(*)::int AS n FROM weekly_checkin_exercises WHERE user_id = $1`, [U])).rows[0].n as number,
    prefs: (await pool.query(`SELECT count(*)::int AS n FROM exercise_preferences WHERE user_id = $1`, [U])).rows[0].n as number,
    history: (await pool.query(`SELECT count(*)::int AS n FROM coach_changes WHERE user_id = $1`, [U])).rows[0].n as number,
    restDays: (await pool.query(`SELECT count(*)::int AS n FROM rest_days WHERE user_id = $1`, [U])).rows[0].n as number,
  })

  it('a save that waits on the squat\'s lock past the wait is refused whole (409), nothing is written, reported once; a retry after release saves', async () => {
    const other = await pool.connect()
    try {
      await other.query('BEGIN')
      await other.query(`SELECT pg_advisory_xact_lock(hashtext('exercise_preferences:name'), hashtext($1))`, [`${U}:${SQ}`])
      const t0 = Date.now()
      await expect(save()).rejects.toMatchObject({ status: 409, code: 'stale' })
      expect(Date.now() - t0).toBeLessThan(3000)
      // The days off and the shorter session were written earlier in the same transaction: gone with it.
      expect(await written()).toEqual({ checkins: 0, liftRows: 0, prefs: 0, history: 0, restDays: 0 })
      expect(reportServerError).toHaveBeenCalledTimes(1)
    } finally {
      await other.query('ROLLBACK').catch(() => undefined)
      other.release()
    }
    const { state } = await save()
    expect(state.checkin!.lifts.find(l => l.exerciseName === SQ)).toMatchObject({ effect: 'lowered_one_step' })
    expect(await written()).toMatchObject({ checkins: 1, prefs: 1, history: 1, restDays: 2 })
  })
})
