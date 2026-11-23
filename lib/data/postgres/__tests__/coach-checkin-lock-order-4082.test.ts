/**
 * #4082: a weekly check-in save and a Coach apply on a sibling lift of the same person, at once.
 *
 * The check-in applies its lifts one after another in one transaction. Each apply takes that lift's lock
 * and then updates the stored plan row, and one stored plan holds several lifts. A Coach apply on the
 * second lift holds that lift and wants the plan row the check-in already updated, while the check-in
 * then wants that lift: a cycle, which Postgres ends with 40P01 after its 1 s deadlock timeout (a 500 on
 * either side). The fix is one lock order for every writer: the person's lift-write lock first.
 *
 * The first test drives it deterministically through the real functions (`saveCheckin`, `applyCoachPatch`)
 * on real connections: a trigger on `coach_changes` holds the check-in between its two lifts until the
 * Coach apply is queued behind it. Runs only against a real Postgres (DATABASE_URL). Made-up names only.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr, todayInTz, weekStartForDay } from '@trainingai/shared/date-utils'

const reportServerError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/observability', () => ({ reportServerError }))

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const U = '00000000-0000-4000-8000-0000040820a1'
const SQ = 'Q4082 Squat'
const BP = 'Q4082 Press'
const GATE = 40821 // advisory key the trigger below waits on

const W0 = shiftDateStr(weekStartForDay(todayInTz(TZ)), -7)
const local = (dayOffset: number, hour: number) => new Date(dateStrMidnightInTz(shiftDateStr(W0, dayOffset), TZ).getTime() + hour * 3_600_000)
const NOW = local(2, 18)

describe.skipIf(!canRun)('check-in save and Coach apply on sibling lifts (#4082)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let engine: typeof import('@/lib/weekly-checkin/engine')
  let apply: typeof import('@/lib/coach/apply')
  let ctx: import('@/lib/weekly-checkin/engine').EngineCtx
  const libIds: string[] = []
  const ids = {} as Record<string, string>

  const planOf = (rows: object[]) => ({
    phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: '', confidence: 1,
    estimatedSessionDurationMin: 45, weeklyVolumeContribution: {}, exercises: rows,
  })
  const seedPlan = () => planOf([
    { sessionExerciseId: ids.sq, name: SQ, sets: 3, reps: 5, pct: 75, restSec: 150 },
    { sessionExerciseId: ids.bp, name: BP, sets: 3, reps: 5, pct: 75, restSec: 150 },
  ])

  const seed = async () => {
    const program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, created_at) VALUES ($1,'Lock order test','ai_dynamic',true,'strength', now() - interval '90 days') RETURNING id`, [U])).rows[0].id
    ids.session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Day 4082',0) RETURNING id`, [program])).rows[0].id
    const schedule = (await pool.query(`INSERT INTO schedules (program_id, type) VALUES ($1,'weekly') RETURNING id`, [program])).rows[0].id
    for (const day of [0, 1, 2]) await pool.query(`INSERT INTO schedule_days (schedule_id, day_of_week, session_id) VALUES ($1,$2,$3)`, [schedule, day, ids.session])
    const ex = async (name: string, pos: number) =>
      (await pool.query(`INSERT INTO session_exercises (session_id, exercise_name, exercise_id, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,$4,'primary',$5) RETURNING id`,
        [ids.session, name, ids[`lib:${name}`], pos, name === SQ ? ['quadriceps'] : ['chest']])).rows[0].id as string
    ids.sq = await ex(SQ, 0)
    ids.bp = await ex(BP, 1)
    for (const [name, rm] of [[SQ, 140], [BP, 100]] as const) {
      await pool.query(`INSERT INTO exercise_estimates (user_id, exercise_name, exercise_id, estimated_1rm) VALUES ($1,$2,$3,$4)`, [U, name, ids[`lib:${name}`], rm])
    }
    for (let d = 0; d < 3; d++) {
      const ws = (await pool.query(
        `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Day 4082',$3,$4) RETURNING id`,
        [U, ids.session, local(d, 12), local(d, 13)])).rows[0].id
      for (const name of [SQ, BP]) {
        const el = (await pool.query(
          `INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, estimated_1rm, logged_at) VALUES ($1,$2,$3,100,$4) RETURNING id`,
          [ws, name, ids[`lib:${name}`], local(d, 12.5)])).rows[0].id
        for (let n = 1; n <= 3; n++) {
          const miss = d === 2 && n === 2 // both lifts fall short in the last session: Heavy lowers each one step
          await pool.query(
            `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, planned_reps, planned_weight_kg, planned_pct, rest_time_sec, planned_rest_sec)
             VALUES ($1,$2,80,$3,5,80,75,150,150)`, [el, n, miss ? 3 : 5])
        }
      }
    }
    await resetPlan()
  }
  const resetPlan = async () => {
    await pool.query(
      `INSERT INTO session_periodization (user_id, program_session_id, phase, prescription, prescription_status, baseline_complete, prescription_generated_at, prescription_expires_at)
       VALUES ($1,$2,'accumulation',$3,'accepted',true, now(), now() + interval '3 days')
       ON CONFLICT (user_id, program_session_id) DO UPDATE SET prescription = EXCLUDED.prescription, prescription_status = 'accepted'`,
      [U, ids.session, JSON.stringify(seedPlan())])
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    db = client.getDb()
    engine = await import('@/lib/weekly-checkin/engine')
    apply = await import('@/lib/coach/apply')
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
    // The gate: while the test holds this advisory lock exclusively, an insert of a history row for the
    // test user waits (shared, so waiters do not block each other). Dropped in afterAll.
    await pool.query(`CREATE OR REPLACE FUNCTION test_4082_gate() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN IF NEW.user_id = '${U}'::uuid THEN PERFORM pg_advisory_xact_lock_shared(${GATE}, 1); END IF; RETURN NEW; END $f$`)
    await pool.query(`DROP TRIGGER IF EXISTS test_4082_gate ON coach_changes`)
    await pool.query(`CREATE TRIGGER test_4082_gate BEFORE INSERT ON coach_changes FOR EACH ROW EXECUTE FUNCTION test_4082_gate()`)
  })

  // Runs on failure too: the fixtures go by id, the shared catalogue rows by the ids made here.
  afterAll(async () => {
    if (!pool) return
    await pool.query(`DROP TRIGGER IF EXISTS test_4082_gate ON coach_changes`).catch(() => undefined)
    await pool.query(`DROP FUNCTION IF EXISTS test_4082_gate()`).catch(() => undefined)
    await pool.query(`DELETE FROM users WHERE id = $1`, [U])
    await pool.query(`DELETE FROM exercise_library WHERE id = ANY($1::uuid[]) OR name = ANY($2)`, [libIds, [SQ, BP]])
  })

  beforeEach(async () => {
    reportServerError.mockClear()
    await pool.query(`DELETE FROM users WHERE id = $1`, [U])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [U, `q4082-${U}@example.com`, TZ])
    await seed()
  })

  const save = (c = ctx) => engine.saveCheckin(c, {
    weekStart: W0,
    lifts: [{ sessionExerciseId: ids.sq, answer: 'heavy' }, { sessionExerciseId: ids.bp, answer: 'heavy' }],
    pain: null, swap: null, daysOff: null, shorterSessionMin: null,
  })
  const coachRest = (slot: 'sq' | 'bp', to: number, conn: typeof db = db) => {
    const changes = [{ id: `r${slot}${to}`, field: 'restSec', from: null, to }]
    return apply.applyCoachPatch(conn, U, { domain: 'lift_preference', targetId: ids[slot], changes } as never, changes.map(c => c.id), '2026-11-22', TZ)
  }

  const rows = async () => ({
    prefs: (await pool.query(`SELECT exercise_name, rest_sec, next_load_step, source, deleted_at FROM exercise_preferences WHERE user_id = $1 ORDER BY exercise_name`, [U])).rows,
    history: (await pool.query(`SELECT id, domain, summary, undone_at FROM coach_changes WHERE user_id = $1`, [U])).rows,
    plan: (await pool.query(`SELECT prescription FROM session_periodization WHERE user_id = $1 AND program_session_id = $2`, [U, ids.session])).rows[0]?.prescription,
  })

  const waitUntil = async (what: string, test: () => Promise<boolean>) => {
    const deadline = Date.now() + 8000
    while (!(await test())) {
      if (Date.now() > deadline) throw new Error(`never reached: ${what}`)
      await new Promise(r => setTimeout(r, 10))
    }
  }
  /** An error as one short line: its Postgres code down the cause chain, else its message. */
  const failure = (err: unknown) => {
    for (let e: unknown = err, i = 0; e && typeof e === 'object' && i < 5; e = (e as { cause?: unknown }).cause, i++) {
      const code = (e as { code?: unknown }).code
      if (typeof code === 'string') return `pg ${code}: ${(e as Error).message}`
    }
    return String(err)
  }
  /** Backends waiting on a lock held by `pid`. */
  const blockedBy = async (pid: number) =>
    (await pool.query(`SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`, [pid])).rows.map(r => r.pid as number)

  it('a check-in save and a Coach apply on its second lift, queued against each other, both finish: no deadlock, no 500', async () => {
    const gate = await pool.connect()
    try {
      await gate.query('BEGIN')
      await gate.query(`SELECT pg_advisory_xact_lock(${GATE}, 1)`)
      const gatePid = (await gate.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number

      // The check-in applies the squat (its lock, the plan row, its history row) and stops at the gate,
      // holding all of it, before it reaches the press.
      const saving = save()
      saving.catch(() => undefined)
      let checkinPid = 0
      await waitUntil('the check-in held at the gate', async () => { const b = await blockedBy(gatePid); checkinPid = b[0] ?? 0; return checkinPid > 0 })

      // The Coach applies a rest to the press and queues behind the check-in (on the plan row before the
      // fix, on the person's lift-write lock after it).
      const coaching = coachRest('bp', 60)
      coaching.catch(() => undefined)
      await waitUntil('the Coach apply queued behind the check-in', async () => (await blockedBy(checkinPid)).length > 0)

      await gate.query('COMMIT') // the check-in goes on to the press
      const [saved, coached] = await Promise.allSettled([saving, coaching])

      expect(saved.status === 'rejected' ? failure(saved.reason) : 'ok').toBe('ok')
      expect(coached.status === 'rejected' ? failure(coached.reason) : 'ok').toBe('ok')
      expect(coached.status === 'fulfilled' && coached.value).toMatchObject({ ok: true })
    } finally {
      await gate.query('ROLLBACK').catch(() => undefined)
      gate.release()
    }

    const after = await rows()
    expect(after.prefs.map(p => [p.exercise_name, p.next_load_step, p.rest_sec, p.source])).toEqual([
      [BP, 'lighter', 60, 'coach'], // the check-in's step, then the Coach's rest on the same row
      [SQ, 'lighter', null, 'checkin'],
    ])
    expect(after.history).toHaveLength(3)
    expect(after.plan).not.toEqual(seedPlan())
    expect(reportServerError).not.toHaveBeenCalled()

    // Undo after the race, in the reverse of the order they landed (the check-in's squat, its press, then the
    // Coach's rest on the press): each is accepted and the stored plan is back as it was seeded. Out of order
    // a plan that another change restated since is voided instead, by design.
    const byLift = async (lift: string, field: string) => (await pool.query(
      `SELECT id FROM coach_changes WHERE user_id = $1 AND summary LIKE $2 AND patch->'changes'->0->>'field' = $3`, [U, `${lift}:%`, field])).rows[0].id as string
    for (const id of [await byLift(BP, 'restSec'), await byLift(BP, 'nextLoadStep'), await byLift(SQ, 'nextLoadStep')]) {
      expect(await apply.undoCoachChange(db, U, id)).toMatchObject({ ok: true })
    }
    const undone = await rows()
    expect(undone.history.every(h => h.undone_at != null)).toBe(true)
    expect(undone.prefs.every(p => p.deleted_at != null || (p.rest_sec == null && p.next_load_step == null))).toBe(true)
    expect(undone.plan).toEqual(seedPlan())
  }, 30_000)

  describe('the backstop: a deadlock that still happens is "busy, try again", never a 500', () => {
    /**
     * A writer in the OLD order, standing in for any writer that holds a stored plan row and then wants a
     * lift's lock: it takes the plan row, waits until the writer under test is queued behind it, then asks for
     * the squat's lock the writer already holds. That is a lock cycle; the writer that has waited longest is
     * the one Postgres cancels (40P01, after its 1 s deadlock timeout).
     */
    const againstOldOrderWriter = async (start: () => Promise<unknown>) => {
      const other = await pool.connect()
      try {
        await other.query('BEGIN')
        await other.query(`UPDATE session_periodization SET updated_at = now() WHERE user_id = $1 AND program_session_id = $2`, [U, ids.session])
        const pid = (await other.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid as number
        const running = start()
        running.catch(() => undefined)
        await waitUntil('the writer queued behind the plan row', async () => (await blockedBy(pid)).length > 0)
        const asking = other.query(`SELECT pg_advisory_xact_lock(hashtext('exercise_preferences:name'), hashtext($1))`, [`${U}:${SQ}`])
        asking.catch(() => undefined)
        const settled = await Promise.allSettled([running])
        await asking // the cancelled writer released its lock, so the other side now gets it
        return settled[0]
      } finally {
        await other.query('ROLLBACK').catch(() => undefined)
        other.release()
      }
    }

    it('a Coach apply cancelled as the deadlock victim answers busy, writes nothing, and is reported once', async () => {
      const before = await rows()
      const res = await againstOldOrderWriter(() => coachRest('sq', 70))
      expect(res.status === 'rejected' ? failure(res.reason) : res.value).toEqual({ ok: false, reason: 'busy' })
      const after = await rows()
      expect(after.prefs).toEqual([])
      expect(after.history).toEqual([])
      expect(after.plan).toEqual(before.plan)
      expect(reportServerError).toHaveBeenCalledTimes(1)
      // And the same request goes through once the other writer is gone.
      expect(await coachRest('sq', 70)).toMatchObject({ ok: true })
    }, 30_000)

    it('a check-in save cancelled as the deadlock victim is refused whole (409, try again), nothing saved, reported once', async () => {
      const res = await againstOldOrderWriter(() => save())
      expect(res.status === 'rejected' ? res.reason : null).toMatchObject({ status: 409, code: 'stale' })
      const after = await rows()
      expect(after.prefs).toEqual([])
      expect(after.history).toEqual([])
      expect((await pool.query(`SELECT count(*)::int AS n FROM weekly_checkins WHERE user_id = $1`, [U])).rows[0].n).toBe(0)
      expect((await pool.query(`SELECT count(*)::int AS n FROM weekly_checkin_exercises WHERE user_id = $1`, [U])).rows[0].n).toBe(0)
      expect(reportServerError).toHaveBeenCalledTimes(1)
      expect((await save()).state.checkin).toBeTruthy()
    }, 30_000)
  })

  describe("the person's lift-write lock held for longer than the wait", () => {
    let wait: { ms: number }
    let was = 0
    beforeAll(async () => { wait = (await import('@/lib/coach/lock-wait')).lockWait; was = wait.ms; wait.ms = 300 })
    afterAll(() => { if (wait) wait.ms = was })

    const holding = async (run: () => Promise<unknown>) => {
      const other = await pool.connect()
      try {
        await other.query('BEGIN')
        await other.query(`SELECT pg_advisory_xact_lock(hashtext('lift_writes:user'), hashtext($1))`, [U])
        const t0 = Date.now()
        const out = await Promise.allSettled([run()])
        expect(Date.now() - t0).toBeLessThan(3000)
        return out[0]
      } finally {
        await other.query('ROLLBACK').catch(() => undefined)
        other.release()
      }
    }

    it('a Coach undo answers busy, undoes nothing, reported once; after release it goes through', async () => {
      const applied = await coachRest('sq', 80)
      expect(applied).toMatchObject({ ok: true })
      const changeId = (applied as { changeId: string }).changeId
      const res = await holding(() => apply.undoCoachChange(db, U, changeId))
      expect(res.status === 'fulfilled' ? res.value : failure((res as PromiseRejectedResult).reason)).toEqual({ ok: false, reason: 'busy' })
      expect((await rows()).history[0].undone_at).toBeNull()
      expect(reportServerError).toHaveBeenCalledTimes(1)
      expect(await apply.undoCoachChange(db, U, changeId)).toMatchObject({ ok: true })
    })

    it('a check-in save is refused whole (409, try again), nothing saved, reported once; after release it saves', async () => {
      const res = await holding(() => save())
      expect(res.status === 'rejected' ? res.reason : null).toMatchObject({ status: 409, code: 'stale' })
      const after = await rows()
      expect(after.prefs).toEqual([])
      expect(after.history).toEqual([])
      expect((await pool.query(`SELECT count(*)::int AS n FROM weekly_checkins WHERE user_id = $1`, [U])).rows[0].n).toBe(0)
      expect(reportServerError).toHaveBeenCalledTimes(1)
      expect((await save()).state.checkin).toBeTruthy()
    })
  })

  describe('stress: Coach applies and check-in saves for one person, all at once', () => {
    const ROUNDS = Number(process.env.STRESS_ROUNDS ?? 50)
    const rangeOf = (slot: 'sq' | 'bp', to: string) => {
      const changes = [{ id: `g${slot}${to}`, field: 'repRange', from: null, to }]
      return apply.applyCoachPatch(db, U, { domain: 'lift_preference', targetId: ids[slot], changes } as never, [changes[0].id], '2026-11-22', TZ)
    }

    it(`${ROUNDS} rounds of 20 parallel writers: only clean refusals, one preference row per lift, history matches, every change undoes`, async () => {
      const bad: string[] = []
      let okApplies = 0
      let refusals = 0
      let saves = 0
      for (let round = 0; round < ROUNDS; round++) {
        await pool.query(`DELETE FROM exercise_preferences WHERE user_id = $1`, [U])
        await pool.query(`DELETE FROM coach_changes WHERE user_id = $1`, [U])
        await pool.query(`DELETE FROM weekly_checkins WHERE user_id = $1`, [U])
        await resetPlan()
        const jobs: Promise<void>[] = []
        const outcomes = { ok: 0 }
        const coach = (run: () => Promise<{ ok: boolean; reason?: string }>) => jobs.push(run().then(
          r => { if (r.ok) { outcomes.ok++; okApplies++ } else if (r.reason === 'stale' || r.reason === 'busy') refusals++; else bad.push(`apply ${r.reason}`) },
          e => { bad.push(`apply threw ${failure(e)}`) }))
        for (let i = 0; i < 20; i++) {
          if (i % 5 === 4) {
            jobs.push(save().then(() => { saves++ }, e => {
              if (e instanceof engine.CheckinRefusal && e.status === 409) refusals++
              else bad.push(`save threw ${failure(e)}`)
            }))
          } else if (i % 5 === 0 || i % 5 === 3) coach(() => coachRest(i % 5 === 0 ? 'sq' : 'bp', 60 + i))
          else coach(() => rangeOf(i % 5 === 1 ? 'sq' : 'bp', i % 2 ? '10-12' : '6-8'))
        }
        await Promise.all(jobs)

        const prefCounts = (await pool.query(`SELECT exercise_name, count(*)::int AS n FROM exercise_preferences WHERE user_id = $1 GROUP BY 1`, [U])).rows
        if (prefCounts.some(r => r.n !== 1)) bad.push(`round ${round}: preference rows ${JSON.stringify(prefCounts)}`)
        const history = (await pool.query(`SELECT count(*)::int AS n FROM coach_changes WHERE user_id = $1 AND undone_at IS NULL`, [U])).rows[0].n as number
        const checkinChanges = (await pool.query(`SELECT count(DISTINCT applied_change_id)::int AS n FROM weekly_checkin_exercises WHERE user_id = $1 AND deleted_at IS NULL AND applied_change_id IS NOT NULL`, [U])).rows[0].n as number
        if (history !== outcomes.ok + checkinChanges) bad.push(`round ${round}: history ${history} != applied ${outcomes.ok} + check-in ${checkinChanges}`)

        // Every change undoes: a pass undoes what is the newest on its lift, the rest are refused as stale
        // until their turn; it must end with none left.
        const left = new Set((await pool.query(`SELECT id FROM coach_changes WHERE user_id = $1 AND undone_at IS NULL`, [U])).rows.map(r => r.id as string))
        for (let pass = 0; pass < 25 && left.size > 0; pass++) {
          for (const id of [...left]) if ((await apply.undoCoachChange(db, U, id)).ok) left.delete(id)
        }
        if (left.size > 0) bad.push(`round ${round}: ${left.size} changes could not be undone`)
        const live = (await pool.query(`SELECT count(*)::int AS n FROM exercise_preferences WHERE user_id = $1 AND deleted_at IS NULL AND (rest_sec IS NOT NULL OR rep_min IS NOT NULL OR next_load_step IS NOT NULL OR sets_delta IS NOT NULL)`, [U])).rows[0].n as number
        if (live > 0) bad.push(`round ${round}: ${live} preference rows still carry a value after every undo`)
      }
      process.stderr.write(`[#4082 stress] ${ROUNDS} rounds x 20 writers: ${okApplies} applies landed, ${saves} saves, ${refusals} clean refusals, ${bad.length} other\n`)
      expect(bad).toEqual([])
      expect(reportServerError).not.toHaveBeenCalledWith(expect.objectContaining({ code: '40P01' }), expect.anything())
    }, 600_000)
  })
})
