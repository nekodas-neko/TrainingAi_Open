/**
 * #4082 review: the program-phase writers are in the one lock order, a check-in's undo step cannot be
 * swallowed, and the expired-one-shot clear never waits.
 *
 * - `setProgramPhase`, `realignProgramPhase` (and the pending-transition writer, `clearProgramPrescriptions`)
 *   used to lock every stored-plan row of a program in id order and take no lift lock, while a check-in save
 *   or a Coach apply updates one plan row after another in LIFT order. Two plan rows, two orders: a cycle,
 *   `40P01`, a 500. Driven here deterministically: a trigger holds the lift writer after its first plan row
 *   until the mover is queued behind it, then lets both on. They now take the person's lift-write lock first.
 * - A lock timeout in a check-in's undo step used to be turned into "no longer the one in effect": the save
 *   committed with the old change still in effect.
 * - `listExercisePreferences` cleared several expired one-shots in one statement that could wait for a row.
 *
 * Runs only against a real Postgres (DATABASE_URL). Made-up names only; fixtures removed by id in `afterAll`.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr, todayInTz, weekStartForDay } from '@trainingai/shared/date-utils'

const reportServerError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/observability', () => ({ reportServerError }))

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const U = '00000000-0000-4000-8000-0000040820c1'
const SQ = 'Q4082c Squat'
const BP = 'Q4082c Press'
const GATE = 40822 // advisory key the trigger below waits on
/** The two stored-plan rows. A program's movers lock them in id order, so L is locked first. */
const ROW_L = '00000000-0000-4000-8000-0000040820c2'
const ROW_H = '00000000-0000-4000-8000-0000040820c3'

const W0 = shiftDateStr(weekStartForDay(todayInTz(TZ)), -7)
const local = (dayOffset: number, hour: number) => new Date(dateStrMidnightInTz(shiftDateStr(W0, dayOffset), TZ).getTime() + hour * 3_600_000)
const NOW = local(2, 18)

describe.skipIf(!canRun)('program-phase writers in the lift-write lock order (#4082 review)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let engine: typeof import('@/lib/weekly-checkin/engine')
  let apply: typeof import('@/lib/coach/apply')
  let period: typeof import('@/lib/data/postgres/slices/periodization')
  let prefs: typeof import('@/lib/data/postgres/slices/exercise-preferences')
  let lockWait: { ms: number }
  let wasWait = 0
  let ctx: import('@/lib/weekly-checkin/engine').EngineCtx
  const libIds: string[] = []
  const ids = {} as Record<string, string>

  const planOf = (rows: object[]) => ({
    phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: '', confidence: 1,
    estimatedSessionDurationMin: 45, weeklyVolumeContribution: {}, exercises: rows,
  })
  const slot = (id: string, name: string) => ({ sessionExerciseId: id, name, sets: 3, reps: 5, pct: 75, restSec: 150 })

  /**
   * Two session types, each with its own stored plan. H (the higher row id) holds the squat; L holds the press.
   * With `sharedSquat` the squat is also in L's plan, so ONE Coach apply on it rewrites both rows. The rows are
   * inserted H first, so a scan of the user's plans meets H first: the lift writer takes H, then L.
   */
  const seed = async (sharedSquat: boolean) => {
    const program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, created_at) VALUES ($1,'Program lock order','ai_dynamic',true,'strength', now() - interval '90 days') RETURNING id`, [U])).rows[0].id
    ids.program = program
    ids.sessH = (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Day H',0) RETURNING id`, [program])).rows[0].id
    ids.sessL = (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Day L',1) RETURNING id`, [program])).rows[0].id
    const schedule = (await pool.query(`INSERT INTO schedules (program_id, type) VALUES ($1,'weekly') RETURNING id`, [program])).rows[0].id
    for (const [day, sess] of [[0, ids.sessH], [1, ids.sessL], [2, ids.sessH]] as const) {
      await pool.query(`INSERT INTO schedule_days (schedule_id, day_of_week, session_id) VALUES ($1,$2,$3)`, [schedule, day, sess])
    }
    const ex = async (session: string, name: string, pos: number) =>
      (await pool.query(`INSERT INTO session_exercises (session_id, exercise_name, exercise_id, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,$4,'primary',$5) RETURNING id`,
        [session, name, ids[`lib:${name}`], pos, name === SQ ? ['quadriceps'] : ['chest']])).rows[0].id as string
    ids.sq = await ex(ids.sessH, SQ, 0)
    ids.bp = await ex(ids.sessL, BP, 0)
    if (sharedSquat) ids.sqL = await ex(ids.sessL, SQ, 1)
    for (const [name, rm] of [[SQ, 140], [BP, 100]] as const) {
      await pool.query(`INSERT INTO exercise_estimates (user_id, exercise_name, exercise_id, estimated_1rm) VALUES ($1,$2,$3,$4)`, [U, name, ids[`lib:${name}`], rm])
    }
    // Each lift falls short in its last session, so Heavy lowers it one step.
    const sessions: [number, string, string][] = [[0, ids.sessH, SQ], [1, ids.sessL, BP], [2, ids.sessH, SQ]]
    for (const [d, sess, name] of sessions) {
      const ws = (await pool.query(
        `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Day',$3,$4) RETURNING id`,
        [U, sess, local(d, 12), local(d, 13)])).rows[0].id
      const el = (await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, estimated_1rm, logged_at) VALUES ($1,$2,$3,100,$4) RETURNING id`,
        [ws, name, ids[`lib:${name}`], local(d, 12.5)])).rows[0].id
      for (let n = 1; n <= 3; n++) {
        const miss = (name === SQ ? d === 2 : d === 1) && n === 2
        await pool.query(
          `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, planned_reps, planned_weight_kg, planned_pct, rest_time_sec, planned_rest_sec)
           VALUES ($1,$2,80,$3,5,80,75,150,150)`, [el, n, miss ? 3 : 5])
      }
    }
    const row = (id: string, sess: string, plan: object) => pool.query(
      `INSERT INTO session_periodization (id, user_id, program_session_id, phase, phase_started_at, prescription, prescription_status, baseline_complete, prescription_generated_at, prescription_expires_at)
       VALUES ($1,$2,$3,'accumulation', now() - interval '30 days', $4,'accepted',true, now(), now() + interval '3 days')`,
      [id, U, sess, JSON.stringify(plan)])
    await row(ROW_H, ids.sessH, planOf([slot(ids.sq, SQ)]))
    await row(ROW_L, ids.sessL, planOf(sharedSquat ? [slot(ids.bp, BP), slot(ids.sqL, SQ)] : [slot(ids.bp, BP)]))
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    db = client.getDb()
    engine = await import('@/lib/weekly-checkin/engine')
    apply = await import('@/lib/coach/apply')
    period = await import('@/lib/data/postgres/slices/periodization')
    prefs = await import('@/lib/data/postgres/slices/exercise-preferences')
    lockWait = (await import('@/lib/coach/lock-wait')).lockWait
    wasWait = lockWait.ms
    const repo = await (await import('@/lib/data')).getRepositoryAsync()
    ctx = { db, repo, userId: U, tz: TZ, now: NOW }
    await pool.query(`DELETE FROM exercise_library WHERE name = ANY($1)`, [[SQ, BP]])
    for (const [name, muscle] of [[SQ, 'quads'], [BP, 'chest']]) {
      const id = (await pool.query(
        `INSERT INTO exercise_library (name, equipment, muscles) VALUES ($1, ARRAY['barbell'], $2::jsonb) RETURNING id`,
        [name, JSON.stringify([{ muscle, role: 'main' }])])).rows[0].id as string
      ids[`lib:${name}`] = id
      libIds.push(id)
    }
    // The gate: while the test holds this advisory lock exclusively, an update of row H of the stored plans
    // waits (shared, so waiters do not block each other), holding the row. Dropped in afterAll.
    await pool.query(`CREATE OR REPLACE FUNCTION test_4082c_gate() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN IF NEW.id = '${ROW_H}'::uuid THEN PERFORM pg_advisory_xact_lock_shared(${GATE}, 1); END IF; RETURN NEW; END $f$`)
    await pool.query(`DROP TRIGGER IF EXISTS test_4082c_gate ON session_periodization`)
    await pool.query(`CREATE TRIGGER test_4082c_gate BEFORE UPDATE ON session_periodization FOR EACH ROW EXECUTE FUNCTION test_4082c_gate()`)
  })

  afterAll(async () => {
    if (lockWait) lockWait.ms = wasWait
    if (!pool) return
    await pool.query(`DROP TRIGGER IF EXISTS test_4082c_gate ON session_periodization`).catch(() => undefined)
    await pool.query(`DROP FUNCTION IF EXISTS test_4082c_gate()`).catch(() => undefined)
    await pool.query(`DELETE FROM error_events WHERE url = 'periodization/program-write' AND user_id = $1`, [U])
    await pool.query(`DELETE FROM users WHERE id = $1`, [U])
    await pool.query(`DELETE FROM exercise_library WHERE id = ANY($1::uuid[]) OR name = ANY($2)`, [libIds, [SQ, BP]])
  })

  beforeEach(async () => {
    reportServerError.mockClear()
    lockWait.ms = wasWait
    await pool.query(`DELETE FROM error_events WHERE url = 'periodization/program-write' AND user_id = $1`, [U])
    await pool.query(`DELETE FROM users WHERE id = $1`, [U])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [U, `q4082c-${U}@example.com`, TZ])
  })

  /** Busy program writes are recorded straight to `error_events` (the slice cannot import `reportServerError`). */
  const busyEvents = async (n: number) => {
    const deadline = Date.now() + 3000
    for (;;) {
      const c = (await pool.query(`SELECT count(*)::int AS n FROM error_events WHERE user_id = $1 AND url = 'periodization/program-write'`, [U])).rows[0].n as number
      if (c === n || Date.now() > deadline) return c
      await new Promise(r => setTimeout(r, 20))
    }
  }

  const waitUntil = async (what: string, test: () => Promise<boolean>) => {
    const deadline = Date.now() + 8000
    while (!(await test())) {
      if (Date.now() > deadline) throw new Error(`never reached: ${what}`)
      await new Promise(r => setTimeout(r, 10))
    }
  }
  const failure = (err: unknown) => {
    for (let e: unknown = err, i = 0; e && typeof e === 'object' && i < 5; e = (e as { cause?: unknown }).cause, i++) {
      const code = (e as { code?: unknown }).code
      if (typeof code === 'string') return `pg ${code}: ${(e as Error).message}`
    }
    return String(err)
  }
  const blockedBy = async (pid: number) =>
    (await pool.query(`SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`, [pid])).rows.map(r => r.pid as number)

  const save = (answers: 'heavy' | 'about_right' = 'heavy', lifts = [ids.sq, ids.bp]) => engine.saveCheckin(ctx, {
    weekStart: W0,
    lifts: lifts.map(id => ({ sessionExerciseId: id, answer: answers })),
    pain: null, swap: null, daysOff: null, shorterSessionMin: null,
  })
  const coachRest = (to: number) => {
    const changes = [{ id: `r${to}`, field: 'restSec', from: null, to }]
    return apply.applyCoachPatch(db, U, { domain: 'lift_preference', targetId: ids.sq, changes } as never, changes.map(c => c.id), '2026-11-22', TZ)
  }
  const moves = {
    setProgramPhase: () => period.setProgramPhase(db, U, ids.program, 'intensification', new Date(), null),
    realignProgramPhase: () => period.realignProgramPhase(db, U, ids.program, () => ({
      phase: 'intensification', phaseStartedAt: new Date(), pendingTransition: { programPhase: true } as never,
    } as never)),
  }

  /**
   * A lift writer updates plan row H and stops at the gate holding it; the mover queues behind it (on row H
   * after its row L before the fix; on the person's lift-write lock after it); the gate opens and the lift
   * writer goes on to row L, which the mover holds before the fix: a cycle Postgres ends with 40P01.
   */
  const interleave = async (writer: () => Promise<unknown>, mover: () => Promise<unknown>) => {
    const gate = await pool.connect()
    try {
      await gate.query('BEGIN')
      await gate.query(`SELECT pg_advisory_xact_lock(${GATE}, 1)`)
      const gatePid = (await gate.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number
      const writing = writer()
      writing.catch(() => undefined)
      let writerPid = 0
      await waitUntil('the lift writer held at the gate', async () => { const b = await blockedBy(gatePid); writerPid = b[0] ?? 0; return writerPid > 0 })
      const moving = mover()
      moving.catch(() => undefined)
      await waitUntil('the mover queued behind the lift writer', async () => (await blockedBy(writerPid)).length > 0)
      await gate.query('COMMIT')
      return await Promise.allSettled([writing, moving])
    } finally {
      await gate.query('ROLLBACK').catch(() => undefined)
      gate.release()
    }
  }
  const plans = async () => (await pool.query(`SELECT id, phase, prescription IS NULL AS voided FROM session_periodization WHERE user_id = $1 ORDER BY id`, [U])).rows

  describe.each(Object.entries(moves))('%s', (_name, mover) => {
    it('against a weekly check-in save: both finish, no deadlock, no 500', async () => {
      await seed(false)
      const [saved, moved] = await interleave(() => save(), mover)
      expect(saved.status === 'rejected' ? failure(saved.reason) : 'ok').toBe('ok')
      expect(moved.status === 'rejected' ? failure(moved.reason) : 'ok').toBe('ok')
      expect(reportServerError).not.toHaveBeenCalled()
      expect((await plans()).map(p => p.phase)).toEqual(['intensification', 'intensification'])
      expect((await pool.query(`SELECT count(*)::int AS n FROM weekly_checkins WHERE user_id = $1`, [U])).rows[0].n).toBe(1)
    }, 30_000)

    it('against a Coach apply that rewrites both plans: both finish, no deadlock, no 500', async () => {
      await seed(true)
      const [applied, moved] = await interleave(() => coachRest(70), mover)
      expect(applied.status === 'rejected' ? failure(applied.reason) : 'ok').toBe('ok')
      expect(applied.status === 'fulfilled' && applied.value).toMatchObject({ ok: true })
      expect(moved.status === 'rejected' ? failure(moved.reason) : 'ok').toBe('ok')
      expect(reportServerError).not.toHaveBeenCalled()
      expect((await plans()).map(p => p.phase)).toEqual(['intensification', 'intensification'])
      expect((await pool.query(`SELECT count(*)::int AS n FROM coach_changes WHERE user_id = $1`, [U])).rows[0].n).toBe(1)
    }, 30_000)

    it('a mover that cannot get the lift-write lock in the wait is refused as busy, reported once, with nothing written', async () => {
      await seed(false)
      lockWait.ms = 300
      const other = await pool.connect()
      try {
        await other.query('BEGIN')
        await other.query(`SELECT pg_advisory_xact_lock(hashtext('lift_writes:user'), hashtext($1))`, [U])
        const t0 = Date.now()
        const res = await Promise.allSettled([mover()])
        expect(Date.now() - t0).toBeLessThan(3000)
        expect(res[0]).toMatchObject({ status: 'rejected', reason: { name: 'BusyError', status: 409 } })
      } finally {
        await other.query('ROLLBACK').catch(() => undefined)
        other.release()
      }
      expect(await busyEvents(1)).toBe(1)
      expect((await plans()).map(p => [p.phase, p.voided])).toEqual([['accumulation', false], ['accumulation', false]])
      // And the same call goes through once the lock is free.
      await mover()
      expect((await plans()).map(p => p.phase)).toEqual(['intensification', 'intensification'])
    }, 30_000)

  })

  it('clearProgramPrescriptions waits for the lock like the movers: busy past the wait, nothing cleared, then clears', async () => {
    await seed(false)
    lockWait.ms = 300
    const other = await pool.connect()
    try {
      await other.query('BEGIN')
      await other.query(`SELECT pg_advisory_xact_lock(hashtext('lift_writes:user'), hashtext($1))`, [U])
      const res = await Promise.allSettled([period.clearProgramPrescriptions(db, U, ids.program)])
      expect(res[0]).toMatchObject({ status: 'rejected', reason: { name: 'BusyError', status: 409 } })
    } finally {
      await other.query('ROLLBACK').catch(() => undefined)
      other.release()
    }
    expect((await plans()).map(p => p.voided)).toEqual([false, false])
    await period.clearProgramPrescriptions(db, U, ids.program)
    expect((await plans()).map(p => p.voided)).toEqual([true, true])
  })

  it('clearProgramPrescriptions against a check-in save: both finish, no deadlock', async () => {
    await seed(false)
    const [saved, cleared] = await interleave(() => save(), () => period.clearProgramPrescriptions(db, U, ids.program))
    expect(saved.status === 'rejected' ? failure(saved.reason) : 'ok').toBe('ok')
    expect(cleared.status === 'rejected' ? failure(cleared.reason) : 'ok').toBe('ok')
  }, 30_000)

  it('the sessions-in-phase repair skips when the lock is held instead of waiting, and runs when it is free', async () => {
    await seed(false)
    await pool.query(`UPDATE session_periodization SET sessions_in_phase = 9 WHERE user_id = $1`, [U])
    const other = await pool.connect()
    try {
      await other.query('BEGIN')
      await other.query(`SELECT pg_advisory_xact_lock(hashtext('lift_writes:user'), hashtext($1))`, [U])
      const t0 = Date.now()
      await period.reconcileSessionsInPhase(db, U, ids.program)
      expect(Date.now() - t0).toBeLessThan(2000)
    } finally {
      await other.query('ROLLBACK').catch(() => undefined)
      other.release()
    }
    expect((await pool.query(`SELECT sessions_in_phase FROM session_periodization WHERE user_id = $1`, [U])).rows.map(r => r.sessions_in_phase)).toEqual([9, 9])
    await period.reconcileSessionsInPhase(db, U, ids.program)
    expect((await pool.query(`SELECT sessions_in_phase FROM session_periodization WHERE user_id = $1`, [U])).rows.map(r => r.sessions_in_phase)).not.toContain(9)
  })

  describe('a lock timeout inside a check-in undo step fails the whole save', () => {
    it('Heavy, then About right while the lift preference row is held: refused 409, answer still Heavy, lowering still in effect, nothing written', async () => {
      await seed(false)
      const first = await save('heavy', [ids.sq])
      expect(first.state.checkin).toBeTruthy()
      const before = {
        history: (await pool.query(`SELECT id, undone_at FROM coach_changes WHERE user_id = $1`, [U])).rows,
        prefs: (await pool.query(`SELECT next_load_step FROM exercise_preferences WHERE user_id = $1`, [U])).rows,
        answers: (await pool.query(`SELECT answer, applied_change_id FROM weekly_checkin_exercises WHERE user_id = $1 AND deleted_at IS NULL`, [U])).rows,
      }
      expect(before.history).toHaveLength(1)
      expect(before.prefs).toEqual([{ next_load_step: 'lighter' }])
      expect(before.answers[0].answer).toBe('heavy')

      lockWait.ms = 300
      const other = await pool.connect()
      let res: PromiseSettledResult<unknown>
      try {
        await other.query('BEGIN')
        await other.query(`SELECT 1 FROM exercise_preferences WHERE user_id = $1 FOR UPDATE`, [U])
        const t0 = Date.now()
        res = (await Promise.allSettled([save('about_right', [ids.sq])]))[0]
        expect(Date.now() - t0).toBeLessThan(3000)
      } finally {
        await other.query('ROLLBACK').catch(() => undefined)
        other.release()
      }
      expect(res.status === 'rejected' ? res.reason : res.value).toMatchObject({ status: 409, code: 'stale' })
      expect(reportServerError).toHaveBeenCalledTimes(1)
      const after = {
        history: (await pool.query(`SELECT id, undone_at FROM coach_changes WHERE user_id = $1`, [U])).rows,
        prefs: (await pool.query(`SELECT next_load_step FROM exercise_preferences WHERE user_id = $1`, [U])).rows,
        answers: (await pool.query(`SELECT answer, applied_change_id FROM weekly_checkin_exercises WHERE user_id = $1 AND deleted_at IS NULL`, [U])).rows,
      }
      expect(after).toEqual(before)

      // Retried with the row free, the same redo goes through: answered About right, the lowering undone.
      await save('about_right', [ids.sq])
      expect((await pool.query(`SELECT answer FROM weekly_checkin_exercises WHERE user_id = $1 AND deleted_at IS NULL`, [U])).rows).toEqual([{ answer: 'about_right' }])
      expect((await pool.query(`SELECT undone_at FROM coach_changes WHERE user_id = $1`, [U])).rows[0].undone_at).not.toBeNull()
    }, 30_000)
  })

  describe('listExercisePreferences: the expired one-shot clear never waits for a row', () => {
    const stale = (name: string) => pool.query(
      `INSERT INTO exercise_preferences (user_id, exercise_id, exercise_name, next_load_step, one_shot_set_at, source)
       VALUES ($1,$2,$3,'lighter', now() - interval '60 days', 'coach')`, [U, ids[`lib:${name}`], name])
    const stepOf = async (name: string) =>
      (await pool.query(`SELECT next_load_step FROM exercise_preferences WHERE user_id = $1 AND exercise_name = $2`, [U, name])).rows[0].next_load_step as string | null

    it('a row another writer holds is left for the next read; the others are cleared at once', async () => {
      await stale(SQ)
      await stale(BP)
      const other = await pool.connect()
      try {
        await other.query('BEGIN')
        await other.query(`SELECT 1 FROM exercise_preferences WHERE user_id = $1 AND exercise_name = $2 FOR UPDATE`, [U, SQ])
        const cleared: { exerciseName: string }[] = []
        const t0 = Date.now()
        const read = await Promise.race([
          prefs.listExercisePreferences(db, U, [SQ, BP], cleared as never),
          new Promise<'waited'>(r => setTimeout(() => r('waited'), 2500)),
        ])
        expect(read).not.toBe('waited')
        expect(Date.now() - t0).toBeLessThan(2500)
        expect(cleared.map(c => c.exerciseName)).toEqual([BP])
        // The held row is still read as expired, whether or not it was cleared.
        expect((read as Map<string, { nextLoadStep: string | null }>).get(SQ)?.nextLoadStep ?? null).toBeNull()
        expect(await stepOf(BP)).toBeNull()
      } finally {
        await other.query('ROLLBACK').catch(() => undefined)
        other.release()
      }
      expect(await stepOf(SQ)).toBe('lighter')
      const cleared: { exerciseName: string }[] = []
      await prefs.listExercisePreferences(db, U, [SQ, BP], cleared as never)
      expect(cleared.map(c => c.exerciseName)).toEqual([SQ])
      expect(await stepOf(SQ)).toBeNull()
    })
  })
})
