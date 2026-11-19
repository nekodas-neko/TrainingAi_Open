// Against a real Postgres; skips where there is no DATABASE_URL.
//
// #3878: the personal-record reconcile keeps the plausibility check the log path applies
// (`shouldCountTowardPr` → `oneRmImplausible`). An estimate refused at log time is still stored on its
// exercise log, and before this fix one edit, a delete, or the `reconcile-personal-records` job made it
// the all-time record.
//
// #3801: the year review's sets, volume and top exercises count finished, not-deleted workouts only,
// as its session count already did.
//
// #3876: a per-type move into a deload records the phase it came from, so the deload can end there.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003878'
const TZ = 'Australia/Brisbane'
// The individually-legal 500 kg x 100 reps of Q-24 §7, as it would be stored.
const IMPLAUSIBLE = 2166

describe.skipIf(!canRun)('batch 251: records keep the plausibility check, the year review counts finished workouts', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  async function session(at: string, opts: { completed?: boolean } = {}): Promise<string> {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'Batch 251', $2::timestamptz, ${opts.completed === false ? 'NULL' : "$2::timestamptz + interval '1 hour'"}) RETURNING id`,
      [USER, at],
    )
    return ws.rows[0].id
  }
  async function log(name: string, rm: number, at: string, sets: Array<[number, number]> = [[60, 5]], wsId?: string) {
    const ws = wsId ?? await session(at)
    const el = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, volume, logged_at, exercise_deloaded)
       VALUES ($1, $2, $3, 100, $4::timestamptz, false) RETURNING id`,
      [ws, name, rm, at],
    )
    for (const [i, [w, r]] of sets.entries()) {
      await pool.query('INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1, $2, $3, $4)', [el.rows[0].id, i + 1, w, r])
    }
    return { exerciseLogId: el.rows[0].id as string, workoutSessionId: ws }
  }
  const record = async (name: string) => {
    const r = await pool.query('SELECT estimated_1rm FROM personal_records WHERE user_id = $1 AND exercise_name = $2', [USER, name])
    return r.rows[0] ? Number(r.rows[0].estimated_1rm) : null
  }
  const setRecord = (name: string, rm: number) => pool.query(
    `INSERT INTO personal_records (user_id, exercise_name, estimated_1rm, achieved_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, exercise_name) DO UPDATE SET estimated_1rm = EXCLUDED.estimated_1rm`, [USER, name, rm])

  async function clean() {
    await pool.query('DELETE FROM personal_records WHERE user_id = $1', [USER])
    await pool.query('DELETE FROM workout_sessions WHERE user_id = $1', [USER])
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [USER, `batch-251-${USER}@example.com`, TZ],
    )
    await clean()
  })

  afterAll(async () => {
    await clean()
    await pool.query('DELETE FROM users WHERE id = $1', [USER])
  })

  describe('#3878', () => {
    it('the best qualifying log skips an implausible stored estimate', async () => {
      await log('Plaus Row', IMPLAUSIBLE, '2026-05-02T08:00:00Z')
      await log('Plaus Row', 110, '2026-05-09T08:00:00Z')
      expect(await repo.bestQualifyingPersonalRecord(USER, 'Plaus Row')).toMatchObject({ estimated1rm: 110 })
    })

    it('on edit: the record is re-derived from the plausible logs only', async () => {
      const { editExerciseLog } = await import('@/lib/workout/exercise-log-edits')
      await log('Plaus Edit', IMPLAUSIBLE, '2026-05-02T08:00:00Z')
      const edited = await log('Plaus Edit', 100, '2026-05-09T08:00:00Z', [[80, 5]])
      await setRecord('Plaus Edit', 100)
      const r = await editExerciseLog(USER, { exerciseLogId: edited.exerciseLogId, weights: [70], reps: [5] } as never)
      expect(r.found).toBe(true)
      const after = await record('Plaus Edit')
      expect(after).not.toBeNull()
      expect(after!).toBeLessThan(IMPLAUSIBLE)
      expect(after!).toBeLessThan(100)
    })

    it('on delete of a log: the record falls to the next plausible log, not the implausible one', async () => {
      const { deleteExerciseLog } = await import('@/lib/workout/exercise-log-edits')
      await log('Plaus Delete', IMPLAUSIBLE, '2026-05-02T08:00:00Z')
      await log('Plaus Delete', 90, '2026-05-05T08:00:00Z')
      const best = await log('Plaus Delete', 120, '2026-05-09T08:00:00Z')
      await setRecord('Plaus Delete', 120)
      expect((await deleteExerciseLog(USER, best.exerciseLogId)).found).toBe(true)
      expect(await record('Plaus Delete')).toBe(90)
    })

    it('on delete of a session: with only an implausible log left, there is no record', async () => {
      const { deleteWorkoutSessionAndReconcile } = await import('@/lib/workout/delete-session-reconcile')
      await log('Plaus Session', IMPLAUSIBLE, '2026-05-02T08:00:00Z')
      const only = await log('Plaus Session', 95, '2026-05-09T08:00:00Z')
      await setRecord('Plaus Session', 95)
      expect((await deleteWorkoutSessionAndReconcile(USER, only.workoutSessionId)).deleted).toBe(true)
      expect(await record('Plaus Session')).toBeNull()
    })

    it('the reconcile-personal-records job does not raise a record to an implausible estimate', async () => {
      const { reconcilePersonalRecords } = await import('@/lib/workout/reconcile-personal-records')
      await log('Plaus Job', IMPLAUSIBLE, '2026-05-02T08:00:00Z')
      await log('Plaus Job', 85, '2026-05-09T08:00:00Z')
      await setRecord('Plaus Job', 85)
      const r = await reconcilePersonalRecords(repo, USER, TZ, { dryRun: false, exercises: ['Plaus Job'] })
      expect(r.summary).toMatchObject({ raise: 0, unchanged: 1, written: 0 })
      expect(await record('Plaus Job')).toBe(85)
    })
  })

  describe('#3876: a move into a deload records the phase it came from', () => {
    it('records it, keeps it across deload to deload, and clears it on the way out', async () => {
      const { getDb } = await import('@/lib/data/postgres/client')
      const period = await import('@/lib/data/postgres/slices/periodization')
      const db = getDb()
      const prog = await pool.query(`INSERT INTO programs (user_id, name, phase_mode) VALUES ($1, 'Batch 251', 'ai_dynamic') RETURNING id`, [USER])
      const ps = await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'Type A', 0) RETURNING id`, [prog.rows[0].id])
      const id = ps.rows[0].id as string
      const stamp = { newPhase: 'accumulation', reasoning: 'wait', urgency: 'normal', switchOverPending: true, switchOverOn: '2026-11-23' }
      await pool.query(
        `INSERT INTO session_periodization (user_id, program_session_id, phase, phase_started_at, sessions_in_phase, baseline_complete, pending_transition)
         VALUES ($1, $2, 'intensification', '2026-10-08T08:00:00Z', 5, true, $3)`,
        [USER, id, JSON.stringify(stamp)],
      )
      try {
        expect((await period.advancePhase(db, USER, id, 'deload')).preEmergencyDeloadPhase).toBe('intensification')
        expect((await period.advancePhase(db, USER, id, 'deload')).preEmergencyDeloadPhase).toBe('intensification')
        const out = await period.advancePhase(db, USER, id, 'intensification')
        expect(out.preEmergencyDeloadPhase).toBeNull()
        // The switch-over's waiting stamp survives the way out.
        expect(out.pendingTransition).toMatchObject({ switchOverPending: true, switchOverOn: '2026-11-23' })
      } finally {
        await pool.query('DELETE FROM programs WHERE id = $1', [prog.rows[0].id])
      }
    })
  })

  describe('#3801: the year review counts finished workouts only', () => {
    it('an unfinished workout adds no sets, volume or top exercise', async () => {
      const from = new Date('2026-03-01T00:00:00Z')
      const before = await repo.getYearReviewTotals(USER, from)
      const beforeTop = await repo.getYearReviewTopExercises(USER, from, 50)
      const open = await session('2026-06-10T08:00:00Z', { completed: false })
      await log('Year Open Only', 100, '2026-06-10T08:10:00Z', [[60, 5], [60, 5], [60, 5]], open)
      const after = await repo.getYearReviewTotals(USER, from)
      expect(after).toEqual(before)
      const top = await repo.getYearReviewTopExercises(USER, from, 50)
      expect(top.map(t => t.exerciseName)).not.toContain('Year Open Only')
      expect(top).toEqual(beforeTop)
    })

    it('the same workout counts once finished', async () => {
      const from = new Date('2026-03-01T00:00:00Z')
      const before = await repo.getYearReviewTotals(USER, from)
      const ws = await session('2026-06-11T08:00:00Z')
      await log('Year Finished', 100, '2026-06-11T08:10:00Z', [[60, 5], [60, 5]], ws)
      const after = await repo.getYearReviewTotals(USER, from)
      expect(after.totalSets - before.totalSets).toBe(2)
      expect(after.totalVolumeKg - before.totalVolumeKg).toBe(600)
      expect((await repo.getYearReviewTopExercises(USER, from, 50)).map(t => t.exerciseName)).toContain('Year Finished')
    })
  })
})
