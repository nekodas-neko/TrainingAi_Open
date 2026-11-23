/**
 * #4082 review 2: every other multi-row writer of the stored-plan rows, the preference rows and the program
 * tables, driven against a weekly check-in save and a Coach apply with a gate on two real connections.
 *
 * Writers covered here (the lock-order table in the PR body lists the rest):
 *  - `setBaselineComplete` and `recordBaselineAnchors` (complete): `joiningPhase` locked all of a program's
 *    plan rows in id order with no lift lock, so a third session type whose row has the LOWEST id cycled with a
 *    check-in save (the check-in holds lift 1's row and wants lift 2's, the writer the other way round).
 *  - `deleteProgram` and an editor `saveProgram`: the cascade deletes the sessions' plan rows in the order the
 *    sessions sit in the table.
 *  - the exercise rename (#4021) when a person has preference rows under both names.
 *  - `reconcileSessionsInPhase`: skips while the lift lock is held; and the statements it costs a read.
 *
 * The gate: while the test holds an advisory lock exclusively, an UPDATE of plan row H (or, for the second key,
 * plan row B) waits for it, holding that row and everything the writer took before it. Runs only against a real
 * Postgres (DATABASE_URL). Made-up names only; fixtures removed by id in `afterAll`.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr, todayInTz, weekStartForDay } from '@trainingai/shared/date-utils'

const reportServerError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/observability', () => ({ reportServerError }))

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const U = '00000000-0000-4000-8000-0000040820e1'
const SQ = 'Q4082d Squat'
const BP = 'Q4082d Press'
const RENAMED = 'Q4082d Renamed Squat'
const GATE = 40823
/** The three plan rows. A program's writers lock them in id order, so B (the baseline row) is locked first. */
const ROW_B = '00000000-0000-4000-8000-0000040820e2'
const ROW_L = '00000000-0000-4000-8000-0000040820e3'
const ROW_H = '00000000-0000-4000-8000-0000040820e4'

const W0 = shiftDateStr(weekStartForDay(todayInTz(TZ)), -7)
const local = (dayOffset: number, hour: number) => new Date(dateStrMidnightInTz(shiftDateStr(W0, dayOffset), TZ).getTime() + hour * 3_600_000)
const NOW = local(2, 18)

describe.skipIf(!canRun)('the other multi-row writers in the lift-write lock order (#4082 review 2)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let engine: typeof import('@/lib/weekly-checkin/engine')
  let apply: typeof import('@/lib/coach/apply')
  let period: typeof import('@/lib/data/postgres/slices/periodization')
  let programs: typeof import('@/lib/data/postgres/slices/programs')
  let repo: Awaited<ReturnType<typeof import('@/lib/data').getRepositoryAsync>>
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
   * Day H (squat) and Day L (press), each with a stored plan, plus Day B: a session type whose baseline is not
   * done, with the lowest plan-row id. `lFirst` creates Day L before Day H, so a cascade that walks the
   * sessions in table order meets L's plan first. `sharedSquat` puts the squat in L's plan too, so ONE Coach
   * apply on it rewrites both rows. `freeTextPress` makes the press a lift the library does not know (named
   * RENAMED, no library id) so a person can hold preference rows under both names of a rename.
   */
  const seed = async (opts: { sharedSquat?: boolean; lFirst?: boolean; freeTextPress?: boolean } = {}) => {
    const program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, created_at) VALUES ($1,'Program audit','ai_dynamic',true,'strength', now() - interval '90 days') RETURNING id`, [U])).rows[0].id
    ids.program = program
    const session = async (name: string, pos: number) =>
      (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,$2,$3) RETURNING id`, [program, name, pos])).rows[0].id as string
    if (opts.lFirst) { ids.sessL = await session('Day L', 1); ids.sessH = await session('Day H', 0) }
    else { ids.sessH = await session('Day H', 0); ids.sessL = await session('Day L', 1) }
    ids.sessB = await session('Day B', 2)
    const schedule = (await pool.query(`INSERT INTO schedules (program_id, type) VALUES ($1,'weekly') RETURNING id`, [program])).rows[0].id
    for (const [day, sess] of [[0, ids.sessH], [1, ids.sessL], [2, ids.sessH]] as const) {
      await pool.query(`INSERT INTO schedule_days (schedule_id, day_of_week, session_id) VALUES ($1,$2,$3)`, [schedule, day, sess])
    }
    const pressName = opts.freeTextPress ? RENAMED : BP
    const ex = async (session: string, name: string, pos: number, libName = name) =>
      (await pool.query(`INSERT INTO session_exercises (session_id, exercise_name, exercise_id, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,$4,'primary',$5) RETURNING id`,
        [session, name, ids[`lib:${libName}`] ?? null, pos, name === SQ ? ['quadriceps'] : ['chest']])).rows[0].id as string
    ids.sq = await ex(ids.sessH, SQ, 0)
    ids.bp = opts.freeTextPress ? (await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, position, exercise_role, muscle_groups) VALUES ($1,$2,0,'primary',$3) RETURNING id`,
      [ids.sessL, pressName, ['chest']])).rows[0].id as string : await ex(ids.sessL, BP, 0)
    ids.curl = await ex(ids.sessB, BP, 0)
    if (opts.sharedSquat) ids.sqL = await ex(ids.sessL, SQ, 1)
    for (const [name, rm] of [[SQ, 140], [pressName, 100]] as const) {
      await pool.query(`INSERT INTO exercise_estimates (user_id, exercise_name, exercise_id, estimated_1rm) VALUES ($1,$2,$3,$4)`, [U, name, ids[`lib:${name}`] ?? null, rm])
    }
    // Each lift falls short in its last session, so Heavy lowers it one step.
    const sessions: [number, string, string][] = [[0, ids.sessH, SQ], [1, ids.sessL, pressName], [2, ids.sessH, SQ]]
    for (const [d, sess, name] of sessions) {
      const ws = (await pool.query(
        `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Day',$3,$4) RETURNING id`,
        [U, sess, local(d, 12), local(d, 13)])).rows[0].id
      const el = (await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, estimated_1rm, logged_at) VALUES ($1,$2,$3,100,$4) RETURNING id`,
        [ws, name, ids[`lib:${name}`] ?? null, local(d, 12.5)])).rows[0].id
      for (let n = 1; n <= 3; n++) {
        const miss = (name === SQ ? d === 2 : d === 1) && n === 2
        await pool.query(
          `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, planned_reps, planned_weight_kg, planned_pct, rest_time_sec, planned_rest_sec)
           VALUES ($1,$2,80,$3,5,80,75,150,150)`, [el, n, miss ? 3 : 5])
      }
    }
    const row = (id: string, sess: string, plan: object | null, baselineDone: boolean) => pool.query(
      `INSERT INTO session_periodization (id, user_id, program_session_id, phase, phase_started_at, prescription, prescription_status, baseline_complete, prescription_generated_at, prescription_expires_at)
       VALUES ($1,$2,$3,$4, now() - interval '30 days', $5,$6,$7, now(), now() + interval '3 days')`,
      [id, U, sess, baselineDone ? 'accumulation' : 'baseline', plan ? JSON.stringify(plan) : null, plan ? 'accepted' : 'none', baselineDone])
    await row(ROW_B, ids.sessB, null, false)
    await row(ROW_H, ids.sessH, planOf([slot(ids.sq, SQ)]), true)
    await row(ROW_L, ids.sessL, planOf(opts.sharedSquat ? [slot(ids.bp, pressName), slot(ids.sqL, SQ)] : [slot(ids.bp, pressName)]), true)
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    db = client.getDb()
    engine = await import('@/lib/weekly-checkin/engine')
    apply = await import('@/lib/coach/apply')
    period = await import('@/lib/data/postgres/slices/periodization')
    programs = await import('@/lib/data/postgres/slices/programs')
    lockWait = (await import('@/lib/coach/lock-wait')).lockWait
    wasWait = lockWait.ms
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    ctx = { db, repo, userId: U, tz: TZ, now: NOW }
    await pool.query(`DELETE FROM exercise_library WHERE name = ANY($1)`, [[SQ, BP, RENAMED]])
    for (const [name, muscle] of [[SQ, 'quads'], [BP, 'chest']]) {
      const id = (await pool.query(
        `INSERT INTO exercise_library (name, equipment, muscles, created_by) VALUES ($1, ARRAY['barbell'], $2::jsonb, $3) RETURNING id`,
        [name, JSON.stringify([{ muscle, role: 'main' }]), null])).rows[0].id as string
      ids[`lib:${name}`] = id
      libIds.push(id)
    }
    // The gate: while the test holds an advisory lock exclusively, an update of row H (key 1) or row B (key 2)
    // of the stored plans waits (shared, so waiters do not block each other), holding the row. Dropped in afterAll.
    await pool.query(`CREATE OR REPLACE FUNCTION test_4082d_gate() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN
        IF NEW.id = '${ROW_H}'::uuid THEN PERFORM pg_advisory_xact_lock_shared(${GATE}, 1);
        ELSIF NEW.id = '${ROW_B}'::uuid THEN PERFORM pg_advisory_xact_lock_shared(${GATE}, 2); END IF;
        RETURN NEW;
      END $f$`)
    await pool.query(`DROP TRIGGER IF EXISTS test_4082d_gate ON session_periodization`)
    await pool.query(`CREATE TRIGGER test_4082d_gate BEFORE UPDATE ON session_periodization FOR EACH ROW EXECUTE FUNCTION test_4082d_gate()`)
  })

  afterAll(async () => {
    if (lockWait) lockWait.ms = wasWait
    if (!pool) return
    await pool.query(`DROP TRIGGER IF EXISTS test_4082d_gate ON session_periodization`).catch(() => undefined)
    await pool.query(`DROP FUNCTION IF EXISTS test_4082d_gate()`).catch(() => undefined)
    await pool.query(`DELETE FROM error_events WHERE url = 'periodization/program-write' AND user_id = $1`, [U])
    await pool.query(`DELETE FROM users WHERE id = $1`, [U])
    await pool.query(`DELETE FROM exercise_library WHERE id = ANY($1::uuid[]) OR name = ANY($2)`, [libIds, [SQ, BP, RENAMED]])
  })

  beforeEach(async () => {
    reportServerError.mockClear()
    lockWait.ms = wasWait
    await pool.query(`DELETE FROM error_events WHERE url = 'periodization/program-write' AND user_id = $1`, [U])
    await pool.query(`DELETE FROM users WHERE id = $1`, [U])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [U, `q4082d-${U}@example.com`, TZ])
    await pool.query(`UPDATE exercise_library SET name = $2 WHERE id = $1`, [ids[`lib:${SQ}`], SQ])
  })

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
  const outcome = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? failure(r.reason) : 'ok')
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

  /**
   * A lift writer updates plan row H and stops at the gate holding it (and every lock it took before: the
   * lift lock, its preference rows); the other writer queues behind it; the gate opens and the lift writer
   * goes on to its next lift, which the other writer holds before the fix: a cycle Postgres ends with 40P01.
   */
  const interleave = async (writer: () => Promise<unknown>, other: () => Promise<unknown>) => {
    const gate = await pool.connect()
    try {
      await gate.query('BEGIN')
      await gate.query(`SELECT pg_advisory_xact_lock(${GATE}, 1)`)
      const gatePid = (await gate.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number
      const writing = writer()
      writing.catch(() => undefined)
      let writerPid = 0
      await waitUntil('the lift writer held at the gate', async () => { const b = await blockedBy(gatePid); writerPid = b[0] ?? 0; return writerPid > 0 })
      const moving = other()
      moving.catch(() => undefined)
      await waitUntil('the other writer queued behind the lift writer', async () => (await blockedBy(writerPid)).length > 0)
      await gate.query('COMMIT')
      return await Promise.allSettled([writing, moving])
    } finally {
      await gate.query('ROLLBACK').catch(() => undefined)
      gate.release()
    }
  }
  /** Hold the person's lift-write lock on a second connection while `during` runs. */
  const withLiftLockHeld = async (during: () => Promise<void>) => {
    const other = await pool.connect()
    try {
      await other.query('BEGIN')
      await other.query(`SELECT pg_advisory_xact_lock(hashtext('lift_writes:user'), hashtext($1))`, [U])
      await during()
    } finally {
      await other.query('ROLLBACK').catch(() => undefined)
      other.release()
    }
  }
  const planRows = async () => (await pool.query(
    `SELECT id, phase, baseline_complete AS done, prescription IS NULL AS voided FROM session_periodization WHERE user_id = $1 ORDER BY id`, [U])).rows

  // ── setBaselineComplete and recordBaselineAnchors (complete) ────────────────────────────────────────
  const baselineWriters = {
    setBaselineComplete: () => period.setBaselineComplete(db, U, ids.sessB, { [ids.curl]: { kg: 60, source: 'existing' } }),
    'recordBaselineAnchors (complete)': () => period.recordBaselineAnchors(db, U, ids.sessB, { [ids.curl]: { kg: 60, source: 'amrap' } }, true),
  }

  describe.each(Object.entries(baselineWriters))('%s', (_name, writer) => {
    it('against a weekly check-in save: both finish, no deadlock, no 500', async () => {
      await seed()
      const [saved, joined] = await interleave(() => save(), writer)
      expect(outcome(saved)).toBe('ok')
      expect(outcome(joined)).toBe('ok')
      expect(reportServerError).not.toHaveBeenCalled()
      const rows = await planRows()
      expect(rows.find(r => r.id === ROW_B)).toMatchObject({ done: true, phase: 'accumulation' })
      expect((await pool.query(`SELECT count(*)::int AS n FROM weekly_checkins WHERE user_id = $1`, [U])).rows[0].n).toBe(1)
    }, 30_000)

    it('against a Coach apply that rewrites both plans: both finish, no deadlock, no 500', async () => {
      await seed({ sharedSquat: true })
      const [applied, joined] = await interleave(() => coachRest(70), writer)
      expect(outcome(applied)).toBe('ok')
      expect(applied.status === 'fulfilled' && applied.value).toMatchObject({ ok: true })
      expect(outcome(joined)).toBe('ok')
      expect(reportServerError).not.toHaveBeenCalled()
      expect((await planRows()).find(r => r.id === ROW_B)).toMatchObject({ done: true, phase: 'accumulation' })
    }, 30_000)

    it('a writer that cannot get the lift-write lock in the wait is refused as busy, reported once, with nothing written; then it goes through', async () => {
      await seed()
      lockWait.ms = 300
      await withLiftLockHeld(async () => {
        const t0 = Date.now()
        const res = await Promise.allSettled([writer()])
        expect(Date.now() - t0).toBeLessThan(3000)
        expect(res[0]).toMatchObject({ status: 'rejected', reason: { name: 'BusyError', status: 409 } })
      })
      expect(await busyEvents(1)).toBe(1)
      expect((await planRows()).find(r => r.id === ROW_B)).toMatchObject({ done: false, phase: 'baseline' })
      await writer()
      expect((await planRows()).find(r => r.id === ROW_B)).toMatchObject({ done: true, phase: 'accumulation' })
    }, 30_000)
  })

  // The row waits AFTER the lift lock: bounded by `lockWait` (SET LOCAL), not left to the pool's 15 s statement timeout.
  it('a program writer waiting on a plan row a lock-free writer holds gives up at the bound, not at 15 s: busy, nothing written', async () => {
    await seed()
    lockWait.ms = 400
    const other = await pool.connect()
    try {
      await other.query('BEGIN')
      await other.query(`SELECT 1 FROM session_periodization WHERE id = $1 FOR UPDATE`, [ROW_L])
      const t0 = Date.now()
      const res = await Promise.allSettled([
        baselineWriters.setBaselineComplete(),
        period.setProgramPhase(db, U, ids.program, 'intensification', new Date(), null),
      ])
      expect(Date.now() - t0).toBeLessThan(4000)
      for (const r of res) expect(r).toMatchObject({ status: 'rejected', reason: { name: 'BusyError', status: 409 } })
    } finally {
      await other.query('ROLLBACK').catch(() => undefined)
      other.release()
    }
    expect(await busyEvents(2)).toBe(2)
    expect((await planRows()).map(r => r.phase)).toEqual(['baseline', 'accumulation', 'accumulation'])
    // The bound is local to the transaction: the connection the next writer gets has the default back.
    await period.setProgramPhase(db, U, ids.program, 'intensification', new Date(), null)
    expect((await planRows()).filter(r => r.done).map(r => r.phase)).toEqual(['intensification', 'intensification'])
  }, 30_000)

  it('recordBaselineAnchors (partial) writes its one row without the lift lock', async () => {
    await seed()
    await withLiftLockHeld(async () => {
      const t0 = Date.now()
      await period.recordBaselineAnchors(db, U, ids.sessB, { [ids.curl]: { kg: 60, source: 'amrap' } }, false)
      expect(Date.now() - t0).toBeLessThan(2000)
    })
    expect((await pool.query(`SELECT baseline_1rm FROM session_periodization WHERE id = $1`, [ROW_B])).rows[0].baseline_1rm).toMatchObject({ [ids.curl]: { kg: 60 } })
  })

  // ── deleteProgram and an editor saveProgram: the cascade deletes the plan rows ─────────────────────────
  const programPayload = (name = 'Program audit') => ({
    id: ids.program, userId: U, name, isActive: true, phaseMode: 'ai_dynamic', trainingGoal: 'strength',
    createdAt: new Date(), updatedAt: new Date(),
    sessions: [[ids.sessL, 'Day L', 1, ids.bp, BP], [ids.sessH, 'Day H', 0, ids.sq, SQ], [ids.sessB, 'Day B', 2, ids.curl, BP]].map(([id, n, position, exId, exName]) => ({
      id, programId: ids.program, name: n, position,
      exercises: [{ id: exId, sessionId: id, exerciseName: exName, muscleGroups: ['chest'], position: 0, exerciseRole: 'primary' }],
    })),
  }) as never

  describe('deleteProgram', () => {
    it('against a weekly check-in save: both finish, no deadlock (the cascade met L before H)', async () => {
      await seed({ lFirst: true })
      const [saved, deleted] = await interleave(() => save(), () => programs.deleteProgram(db, U, ids.program))
      expect(outcome(saved)).toBe('ok')
      expect(outcome(deleted)).toBe('ok')
      expect((await planRows())).toHaveLength(0)
    }, 30_000)

    it('against a Coach apply that rewrites both plans: both finish, no deadlock', async () => {
      await seed({ lFirst: true, sharedSquat: true })
      const [applied, deleted] = await interleave(() => coachRest(70), () => programs.deleteProgram(db, U, ids.program))
      // The delete is serialised behind the apply (it queues on the lift lock); both end without a fault.
      expect(applied.status === 'rejected' ? failure(applied.reason) : 'ok').toBe('ok')
      expect(outcome(deleted)).toBe('ok')
    }, 30_000)

    it('busy past the wait: refused 409, reported once, nothing deleted; then it deletes', async () => {
      await seed({ lFirst: true })
      lockWait.ms = 300
      await withLiftLockHeld(async () => {
        const res = await Promise.allSettled([programs.deleteProgram(db, U, ids.program)])
        expect(res[0]).toMatchObject({ status: 'rejected', reason: { name: 'BusyError', status: 409 } })
      })
      expect(await busyEvents(1)).toBe(1)
      expect(await planRows()).toHaveLength(3)
      expect((await pool.query(`SELECT count(*)::int AS n FROM programs WHERE id = $1`, [ids.program])).rows[0].n).toBe(1)
      await programs.deleteProgram(db, U, ids.program)
      expect(await planRows()).toHaveLength(0)
    }, 30_000)
  })

  describe('an editor saveProgram of an existing program (voidPrescriptions)', () => {
    it('against a weekly check-in save: both finish, no deadlock (the cascade met L before H)', async () => {
      await seed({ lFirst: true })
      const [saved, edited] = await interleave(() => save(), () => programs.saveProgram(db, U, programPayload('Program audit edited'), { voidPrescriptions: true }))
      expect(outcome(saved)).toBe('ok')
      expect(outcome(edited)).toBe('ok')
    }, 30_000)

    it('busy: the edit is NOT saved and the old plans are NOT voided (one transaction), answered 409; the retry saves and voids', async () => {
      await seed({ lFirst: true })
      lockWait.ms = 300
      await withLiftLockHeld(async () => {
        const res = await Promise.allSettled([programs.saveProgram(db, U, programPayload('Program audit edited'), { voidPrescriptions: true })])
        expect(res[0]).toMatchObject({ status: 'rejected', reason: { name: 'BusyError', status: 409 } })
      })
      expect((await pool.query(`SELECT name FROM programs WHERE id = $1`, [ids.program])).rows[0].name).toBe('Program audit')
      expect((await planRows()).filter(r => r.id !== ROW_B).map(r => r.voided)).toEqual([false, false])
      await programs.saveProgram(db, U, programPayload('Program audit edited'), { voidPrescriptions: true })
      expect((await pool.query(`SELECT name FROM programs WHERE id = $1`, [ids.program])).rows[0].name).toBe('Program audit edited')
      expect((await planRows()).map(r => r.voided)).toEqual([true, true, true])
      expect((await pool.query(`SELECT prescription_status AS s FROM session_periodization WHERE user_id = $1`, [U])).rows.map(r => r.s)).toEqual(['consumed', 'consumed', 'consumed'])
    }, 30_000)

    it('without voidPrescriptions the plans survive the save, as before', async () => {
      await seed({ lFirst: true })
      await programs.saveProgram(db, U, programPayload('Program audit edited'))
      expect((await planRows()).filter(r => r.id !== ROW_B).map(r => r.voided)).toEqual([false, false])
    })

    it('a new program takes no lift lock', async () => {
      await withLiftLockHeld(async () => {
        const t0 = Date.now()
        const saved = await programs.saveProgram(db, U, { ...(programPayload('Brand new') as object), id: '', sessions: [] } as never)
        expect(Date.now() - t0).toBeLessThan(2000)
        await pool.query(`DELETE FROM programs WHERE id = $1`, [saved.id])
      })
    })
  })

  // ── the exercise rename (#4021) ────────────────────────────────────────────────────────────────────────
  describe('renameExercise', () => {
    const asCreator = async () => { await pool.query(`UPDATE exercise_library SET created_by = $2 WHERE id = $1`, [ids[`lib:${SQ}`], U]) }
    /** The person holds a live preference row for the squat and a tombstoned one under the rename's new name. */
    const collide = async () => {
      await pool.query(
        `INSERT INTO exercise_preferences (user_id, exercise_name, exercise_id, rest_sec, source, deleted_at) VALUES ($1,$2,NULL,120,'coach', now())`, [U, RENAMED])
      await pool.query(
        `INSERT INTO exercise_preferences (user_id, exercise_name, exercise_id, rest_sec, source) VALUES ($1,$2,$3,100,'coach')`, [U, SQ, ids[`lib:${SQ}`]])
    }

    it('a person with a preference row under both names, against a check-in saving both lifts: both finish, no deadlock', async () => {
      await seed({ freeTextPress: true })
      await asCreator()
      await collide()
      const [saved, renamed] = await interleave(() => save(), () => repo.renameExercise(U, ids[`lib:${SQ}`], RENAMED))
      expect(outcome(saved)).toBe('ok')
      expect(outcome(renamed)).toBe('ok')
      expect((await pool.query(`SELECT name FROM exercise_library WHERE id = $1`, [ids[`lib:${SQ}`]])).rows[0].name).toBe(RENAMED)
    }, 30_000)

    it('against a Coach lift apply (one preference row, two plan rows): both finish, no deadlock', async () => {
      await seed({ sharedSquat: true })
      await asCreator()
      const [applied, renamed] = await interleave(() => coachRest(70), () => repo.renameExercise(U, ids[`lib:${SQ}`], RENAMED))
      expect(outcome(applied)).toBe('ok')
      expect(outcome(renamed)).toBe('ok')
    }, 30_000)

    it('past the wait for a colliding person\'s lift lock: a lock-wait error, nothing renamed (the route answers it as busy)', async () => {
      await seed({ freeTextPress: true })
      await asCreator()
      await collide()
      lockWait.ms = 300
      await withLiftLockHeld(async () => {
        const res = await Promise.allSettled([repo.renameExercise(U, ids[`lib:${SQ}`], RENAMED)])
        const { isLockWaitTimeout } = await import('@/lib/api/route-errors')
        expect(res[0].status === 'rejected' && isLockWaitTimeout(res[0].reason)).toBe(true)
      })
      expect((await pool.query(`SELECT name FROM exercise_library WHERE id = $1`, [ids[`lib:${SQ}`]])).rows[0].name).toBe(SQ)
      expect((await pool.query(`SELECT exercise_name FROM session_exercises WHERE id = $1`, [ids.sq])).rows[0].exercise_name).toBe(SQ)
    }, 30_000)

    it('a person with no collision does not wait for the lift lock', async () => {
      await seed({ sharedSquat: true })
      await asCreator()
      await withLiftLockHeld(async () => {
        const t0 = Date.now()
        await repo.renameExercise(U, ids[`lib:${SQ}`], RENAMED)
        expect(Date.now() - t0).toBeLessThan(2500)
      })
    }, 30_000)
  })

  // ── reconcileSessionsInPhase ──────────────────────────────────────────────────────────────────────────
  describe('reconcileSessionsInPhase', () => {
    const counters = async () => (await pool.query(`SELECT sessions_in_phase AS n FROM session_periodization WHERE user_id = $1 AND baseline_complete ORDER BY id`, [U])).rows.map(r => r.n as number)

    /** Hold a writer at the gate, run the repair while it is held: it must return at once, leaving the drift. */
    const whileHeldAt = async (key: 1 | 2, writer: () => Promise<unknown>) => {
      const gate = await pool.connect()
      try {
        await gate.query('BEGIN')
        await gate.query(`SELECT pg_advisory_xact_lock(${GATE}, ${key})`)
        const gatePid = (await gate.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number
        const writing = writer()
        writing.catch(() => undefined)
        await waitUntil('the writer held at the gate', async () => (await blockedBy(gatePid)).length > 0)
        const t0 = Date.now()
        await period.reconcileSessionsInPhase(db, U, ids.program)
        expect(Date.now() - t0).toBeLessThan(2000)
        expect(await counters()).toEqual([9, 9])
        await gate.query('COMMIT')
        return await Promise.allSettled([writing])
      } finally {
        await gate.query('ROLLBACK').catch(() => undefined)
        gate.release()
      }
    }

    it('against a check-in save holding a plan row: returns at once, repairs nothing, both finish', async () => {
      await seed()
      await pool.query(`UPDATE session_periodization SET sessions_in_phase = 9 WHERE user_id = $1 AND baseline_complete`, [U])
      const [saved] = await whileHeldAt(1, () => save())
      expect(outcome(saved)).toBe('ok')
      await period.reconcileSessionsInPhase(db, U, ids.program) // free now: repairs
      expect(await counters()).not.toContain(9)
    }, 30_000)

    it('against a baseline writer holding every plan row: returns at once, repairs nothing, both finish', async () => {
      await seed()
      await pool.query(`UPDATE session_periodization SET sessions_in_phase = 9 WHERE user_id = $1 AND baseline_complete`, [U])
      const [joined] = await whileHeldAt(2, baselineWriters.setBaselineComplete)
      expect(outcome(joined)).toBe('ok')
    }, 30_000)

    it('a read with nothing to repair takes no lock and writes nothing; one with drift repairs in one statement', async () => {
      await seed()
      await pool.query(`UPDATE session_periodization SET sessions_in_phase = 9 WHERE user_id = $1 AND baseline_complete`, [U])
      await period.reconcileSessionsInPhase(db, U, ids.program)
      expect(await counters()).not.toContain(9)
      const settled = await counters()
      // Nothing left to repair now: runs while the lift lock is held by someone else, and changes nothing.
      await withLiftLockHeld(async () => { await period.reconcileSessionsInPhase(db, U, ids.program) })
      expect(await counters()).toEqual(settled)
    })

    it('costs ONE statement per read, with and without drift (it was one on main, four on the first fix)', async () => {
      await seed()
      const { Client } = await import('pg')
      const proto = Client.prototype as unknown as { query: (...a: unknown[]) => unknown }
      const orig = proto.query
      let n = 0
      proto.query = function (this: unknown, ...a: unknown[]) { n++; return orig.apply(this, a) }
      try {
        await period.reconcileSessionsInPhase(db, U, ids.program)
        const clean = n
        n = 0
        await pool.query(`UPDATE session_periodization SET sessions_in_phase = 9 WHERE user_id = $1 AND baseline_complete`, [U])
        n = 0
        await period.reconcileSessionsInPhase(db, U, ids.program)
        const drifted = n
        expect({ clean, drifted }).toEqual({ clean: 1, drifted: 1 })
        // For the record, what the transaction form cost: BEGIN, try-lock, UPDATE, COMMIT.
        n = 0
        await db.transaction(async tx => {
          await tx.execute((await import('drizzle-orm')).sql`SELECT pg_try_advisory_xact_lock(hashtext('lift_writes:user'), hashtext(${U})) AS got`)
          await tx.execute((await import('drizzle-orm')).sql`SELECT 1`)
        })
        expect(n).toBe(4)
      } finally {
        proto.query = orig
      }
    })
  })
})
