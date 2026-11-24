/**
 * #4007: a lift change made while a plan is being generated must not be undone by the generator's store.
 *
 * Generation reads the session's lift preferences (rep range, rest, one-off, the weekly check-in's hold),
 * calls the model, then stores. The test gates the (mocked) model call: the lift change lands after the
 * generator has read the preferences and before it stores. The stored plan must then be exactly the plan
 * generation made, restated for the preferences now in force, which is also what the person would have
 * had if the change had landed just AFTER the store (the reference run, same data, a second person).
 *
 * Real writers throughout (`applyCoachPatch`, `saveCheckin`, `undoCheckinEffect`) on a real Postgres; the
 * model is a mock (0 model requests). Runs only against a real Postgres (DATABASE_URL). Made-up names only.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr, todayInTz, weekStartForDay } from '@trainingai/shared/date-utils'

const mocks = vi.hoisted(() => ({
  answer: null as unknown,
  /** Resolves when the model call starts; the model then waits for `release`. */
  started: null as null | (() => void),
  release: null as null | Promise<void>,
  calls: 0,
}))
vi.mock('@/lib/ai/instrument', () => ({
  loggedGenerateObject: async () => {
    mocks.calls++
    mocks.started?.()
    await mocks.release
    return { object: structuredClone(mocks.answer) }
  },
}))

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const LIFT = 'R4007 Cable Row'
const ANCHOR = 'R4007 Back Squat'
const OTHER = 'R4007 Curl'
const W0 = shiftDateStr(weekStartForDay(todayInTz(TZ)), -7)
const local = (dayOffset: number, hour: number) => new Date(dateStrMidnightInTz(shiftDateStr(W0, dayOffset), TZ).getTime() + hour * 3_600_000)
const NOW = local(2, 18)

describe.skipIf(!canRun)('a lift change made while a plan is generated survives the store (#4007)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let repo: import('@/lib/data/repository').WorkoutRepository
  let generate: typeof import('@trainingai/shared/ai-periodization/generate-prescription').generatePrescriptionForSession
  let apply: typeof import('@/lib/coach/apply')
  let engine: typeof import('@/lib/weekly-checkin/engine')
  let hold: typeof import('@trainingai/shared/ai-periodization/checkin-plan-hold')
  const libIds: string[] = []
  const users: string[] = []
  const lib: Record<string, string> = {}
  let counter = 0

  interface Person { id: string; session: string; other: string; slot: Record<string, string> }

  const model = (slot: Person['slot']) => ({
    phase: 'accumulation', phase_action: 'stay', deload: false, reasoning: 'test plan',
    exercises: [
      { session_exercise_id: slot[ANCHOR], name: ANCHOR, sets: 4, reps: 5, pct: 75, rest_sec: 180 },
      { session_exercise_id: slot[LIFT], name: LIFT, sets: 3, reps: 8, pct: 70, rest_sec: 120 },
    ],
  })

  /** A person with an AI-plan program: Upper (anchor + the lift under test), Arms (another lift). */
  const person = async (): Promise<Person> => {
    const id = `00000000-0000-4000-8000-00000040${String(++counter).padStart(4, '0')}`
    users.push(id)
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [id, `r4007-${id}@example.com`, TZ])
    const program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, created_at)
       VALUES ($1,'Race 4007','ai_dynamic',true,'strength', now() - interval '90 days') RETURNING id`, [id])).rows[0].id
    const session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position, time_budget_minutes) VALUES ($1,'Upper 4007',0,75) RETURNING id`, [program])).rows[0].id
    const arms = (await pool.query(`INSERT INTO program_sessions (program_id, name, position, time_budget_minutes) VALUES ($1,'Arms 4007',1,45) RETURNING id`, [program])).rows[0].id
    const schedule = (await pool.query(`INSERT INTO schedules (program_id, type) VALUES ($1,'weekly') RETURNING id`, [program])).rows[0].id
    await pool.query(`INSERT INTO schedule_days (schedule_id, day_of_week, session_id) VALUES ($1,0,$2),($1,2,$3)`, [schedule, session, arms])
    const slot: Record<string, string> = {}
    const ex = async (sid: string, name: string, pos: number, role: string, muscles: string[]) => {
      slot[name] = (await pool.query(
        `INSERT INTO session_exercises (session_id, exercise_name, exercise_id, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [sid, name, lib[name], pos, role, muscles])).rows[0].id
    }
    await ex(session, ANCHOR, 0, 'primary', ['quadriceps'])
    await ex(session, LIFT, 1, 'primary', ['back'])
    await ex(arms, OTHER, 0, 'accessory', ['biceps'])
    for (const [name, rm] of [[ANCHOR, 140], [LIFT, 100], [OTHER, 40]] as const) {
      await pool.query(`INSERT INTO exercise_estimates (user_id, exercise_name, exercise_id, estimated_1rm) VALUES ($1,$2,$3,$4)`, [id, name, lib[name], rm])
    }
    // Three finished Upper sessions in the check-in week; the lift is lifted at 60 kg and every rep is hit,
    // so a "Heavy" answer holds it (no missed rep, no step) to the last bar, 60 kg.
    for (let d = 0; d < 3; d++) {
      const ws = (await pool.query(
        `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Upper 4007',$3,$4) RETURNING id`,
        [id, session, local(d, 12), local(d, 13)])).rows[0].id
      for (const name of [ANCHOR, LIFT]) {
        const el = (await pool.query(
          `INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, estimated_1rm, logged_at) VALUES ($1,$2,$3,100,$4) RETURNING id`,
          [ws, name, lib[name], local(d, 12.5)])).rows[0].id
        for (let n = 1; n <= 3; n++) {
          await pool.query(
            `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, planned_reps, planned_weight_kg, planned_pct, rest_time_sec, planned_rest_sec)
             VALUES ($1,$2,60,5,5,60,75,150,150)`, [el, n])
        }
      }
    }
    for (const sid of [session, arms]) {
      await pool.query(
        `INSERT INTO session_periodization (user_id, program_session_id, phase, sessions_in_phase, baseline_complete, prescription, prescription_status)
         VALUES ($1,$2,'accumulation',2,true,NULL,'consumed')`, [id, sid])
    }
    return { id, session, other: arms, slot }
  }

  const stored = async (p: Person, session = p.session) =>
    (await pool.query(`SELECT prescription FROM session_periodization WHERE user_id = $1 AND program_session_id = $2`, [p.id, session])).rows[0]?.prescription
  const generateFor = async (p: Person) => {
    mocks.answer = model(p.slot)
    return generate(p.id, p.session, repo, TZ)
  }
  /** Generation with a change made while the model is answering (after it read the preferences, before it stores). */
  const generateWhile = async (p: Person, change: () => Promise<unknown>) => {
    mocks.answer = model(p.slot)
    const started = new Promise<void>(resolve => { mocks.started = resolve })
    let go!: () => void
    mocks.release = new Promise<void>(resolve => { go = resolve })
    const generating = generate(p.id, p.session, repo, TZ)
    generating.catch(() => undefined)
    await started
    await change()
    go()
    mocks.started = null
    mocks.release = null
    return generating
  }
  /** The plan as the next read serves it: the check-in's hold applied (or given back) to the stored plan. */
  const served = async (p: Person) => {
    const state = (await repo.getSessionPeriodization(p.id, p.session))!
    return (await hold.holdStoredPlanUnderCheckin(p.id, p.session, repo, TZ, state)).prescription
  }
  /** The numbers a plan row carries, for a readable failure. */
  const rowOf = (plan: { exercises: { name: string }[] } | undefined, name = LIFT) => {
    const r = plan?.exercises.find(e => e.name === name) as Record<string, unknown> | undefined
    return r && { sets: r.sets, reps: r.reps, pct: r.pct, restSec: r.restSec, liftPreference: r.liftPreference }
  }

  const coach = (p: Person, changes: Record<string, unknown>[]) =>
    apply.applyCoachPatch(db, p.id, { domain: 'lift_preference', targetId: p.slot[LIFT], changes } as never, changes.map(c => c.id as string), '2026-11-22', TZ)
  const ctxFor = (p: Person) => ({ db, repo, userId: p.id, tz: TZ, now: NOW })
  const checkinHeavy = (p: Person) => engine.saveCheckin(ctxFor(p), {
    weekStart: W0, lifts: [{ sessionExerciseId: p.slot[LIFT], answer: 'heavy' }], pain: null, swap: null, daysOff: null, shorterSessionMin: null,
  })
  const undoHold = async (p: Person) => {
    const c = (await pool.query(`SELECT c.id AS checkin, e.id AS lift FROM weekly_checkins c JOIN weekly_checkin_exercises e ON e.checkin_id = c.id WHERE c.user_id = $1 AND e.exercise_name = $2`, [p.id, LIFT])).rows[0]
    return engine.undoCheckinEffect(ctxFor(p), c.checkin, { kind: 'lift', liftId: c.lift })
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    db = client.getDb()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    generate = (await import('@trainingai/shared/ai-periodization/generate-prescription')).generatePrescriptionForSession
    apply = await import('@/lib/coach/apply')
    engine = await import('@/lib/weekly-checkin/engine')
    hold = await import('@trainingai/shared/ai-periodization/checkin-plan-hold')
    await pool.query(`DELETE FROM exercise_library WHERE name = ANY($1)`, [[ANCHOR, LIFT, OTHER]])
    for (const [name, equipment, muscle] of [[ANCHOR, 'barbell', 'quads'], [LIFT, 'cable', 'back'], [OTHER, 'dumbbell', 'biceps']]) {
      const id = (await pool.query(
        `INSERT INTO exercise_library (name, equipment, muscles) VALUES ($1, ARRAY[$2], $3::jsonb) RETURNING id`,
        [name, equipment, JSON.stringify([{ muscle, role: 'main' }])])).rows[0].id as string
      lib[name] = id
      libIds.push(id)
    }
  })

  // Runs on failure too: the fixtures go by id, the shared catalogue rows by the ids made here.
  afterAll(async () => {
    if (!pool) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [users])
    await pool.query(`DELETE FROM exercise_library WHERE id = ANY($1::uuid[]) OR name = ANY($2)`, [libIds, [ANCHOR, LIFT, OTHER]])
  })

  /**
   * One change, two people with identical data: A's change lands while the plan is generated, B's lands just
   * after the store. Both end with the same stored plan, and it is not the plan generation made.
   */
  const race = async (name: string, opts: {
    before?: (p: Person) => Promise<unknown>
    change: (p: Person) => Promise<unknown>
  }) => {
    const a = await person()
    const b = await person()
    for (const p of [a, b]) await opts.before?.(p)
    const noChange = await person()
    await opts.before?.(noChange)
    expect(await generateFor(noChange)).toMatchObject({ ok: true })
    const generated = await stored(noChange) // what generation makes with no change at all
    // B: the plan is stored, then the change lands.
    expect(await generateFor(b)).toMatchObject({ ok: true })
    const callsBefore = mocks.calls
    await opts.change(b)
    const after = await served(b)
    // A: the change lands while the model is answering.
    const raced = await generateWhile(a, () => opts.change(a))
    expect(raced).toMatchObject({ ok: true })
    const callsA = mocks.calls - callsBefore
    const storedA = await stored(a)
    return { name, generated: scrub(generated, noChange), after: scrub(after, b), storedA: scrub(storedA, a), servedA: scrub(await served(a), a), callsA }
  }

  /** A plan with each person's own slot ids named by lift (two people's ids differ) and the shadow reads left out. */
  const scrub = (plan: unknown, p: Person) => {
    let text = JSON.stringify(plan, (k, v) => (k === 'sessionReads' ? undefined : v))
    for (const [name, id] of Object.entries(p.slot)) text = text.replaceAll(id, `slot:${name}`)
    // The one-off's time is the database's `now()` at the write: each person's own. Checked against the row below.
    return JSON.parse(text.replace(/("oneShotSetAt":)"[^"]+"/g, '$1"stamped"'))
  }

  const cases: { title: string; opts: Parameters<typeof race>[1]; moves: (r: Awaited<ReturnType<typeof race>>) => void }[] = [
    {
      title: 'a Coach rep-range change',
      opts: { change: async p => expect(await coach(p, [{ id: 'c1', field: 'repRange', from: null, to: '12-15' }])).toMatchObject({ ok: true }) },
      moves: r => { expect(rowOf(r.after)!.reps).not.toBe(rowOf(r.generated)!.reps) },
    },
    {
      title: 'a Coach rest change',
      opts: { change: async p => expect(await coach(p, [{ id: 'c1', field: 'restSec', from: null, to: 45 }])).toMatchObject({ ok: true }) },
      moves: r => { expect(rowOf(r.after)!.restSec).toBe(45) },
    },
    {
      title: 'a one-off "lighter next time" step',
      opts: { change: async p => expect(await coach(p, [{ id: 'c1', field: 'nextLoadStep', from: null, to: 'lighter' }])).toMatchObject({ ok: true }) },
      moves: r => { expect(rowOf(r.after)!.pct).toBeLessThan(rowOf(r.generated)!.pct as number) },
    },
    {
      title: 'a weekly check-in "Heavy" hold saved',
      opts: { change: p => checkinHeavy(p) },
      moves: r => { expect(rowOf(r.after)!.pct).toBeLessThan(rowOf(r.generated)!.pct as number) },
    },
    {
      title: 'a weekly check-in hold undone',
      opts: { before: p => checkinHeavy(p), change: p => undoHold(p) },
      moves: r => { expect(rowOf(r.after)!.pct).toBeGreaterThan(rowOf(r.generated)!.pct as number) },
    },
  ]

  for (const c of cases) {
    it(`${c.title}: the stored plan is the generated plan restated, as if the change had landed after the store`, async () => {
      const r = await race(c.title, c.opts)
      // The change really moved the plan (otherwise the case proves nothing).
      c.moves(r)
      // The race run stored what the after-the-store run serves, whole.
      expect(rowOf(r.storedA), 'stored plan after the race').toEqual(rowOf(r.after))
      expect(r.storedA).toEqual(r.after)
      expect(r.servedA).toEqual(r.after)
      // No model call was repeated.
      expect(r.callsA).toBe(1)
    }, 60_000)
  }

  it('a change to a lift that is not in this session changes nothing', async () => {
    const a = await person()
    const b = await person()
    expect(await generateFor(b)).toMatchObject({ ok: true })
    const generated = await stored(b)
    const calls = mocks.calls
    const raced = await generateWhile(a, async () => {
      const changes = [{ id: 'c1', field: 'repRange', from: null, to: '12-15' }]
      const res = await apply.applyCoachPatch(db, a.id, { domain: 'lift_preference', targetId: a.slot[OTHER], changes } as never, ['c1'], '2026-11-22', TZ)
      expect(res).toMatchObject({ ok: true })
    })
    expect(raced).toMatchObject({ ok: true })
    expect(mocks.calls - calls).toBe(1)
    expect(scrub(await stored(a), a)).toEqual(scrub(generated, b))
  }, 60_000)

  it('a lift lock that stays busy past its bound stores the paid plan as generated, and repeats no model call', async () => {
    const { lockWait } = await import('@/lib/coach/lock-wait')
    const a = await person()
    const b = await person()
    expect(await generateFor(b)).toMatchObject({ ok: true })
    const generated = await stored(b)
    const was = lockWait.ms
    lockWait.ms = 300
    const holder = await pool.connect()
    try {
      const calls = mocks.calls
      const raced = await generateWhile(a, async () => {
        // Another writer of this person's lifts holds the lift-write lock (a check-in save that has not finished).
        await holder.query('BEGIN')
        await holder.query(`SELECT pg_advisory_xact_lock(hashtext('lift_writes:user'), hashtext($1))`, [a.id])
      })
      expect(raced).toMatchObject({ ok: true })
      expect(mocks.calls - calls).toBe(1)
      // Nothing waited past the bound for ever, and the plan was stored (as generated: the change was not made).
      expect(scrub(await stored(a), a)).toEqual(scrub(generated, b))
    } finally {
      lockWait.ms = was
      await holder.query('ROLLBACK').catch(() => undefined)
      holder.release()
    }
  }, 60_000)

  // The store's other guards are in the statement the preference check shares: the phase and its start, and the
  // session's structure stamp. Confirmed against the real store, with the lift lock path taken.
  it('a phase moved by another session type during the model call: the plan is not stored', async () => {
    const a = await person()
    const result = await generateWhile(a, async () => {
      await pool.query(`UPDATE session_periodization SET phase = 'intensification', phase_started_at = now(), updated_at = now() WHERE user_id = $1 AND program_session_id = $2`, [a.id, a.session])
    })
    expect(result.ok).toBe(false)
    expect(await stored(a)).toBeNull()
  }, 60_000)

  it('the session edited during the model call: the plan is not stored', async () => {
    const a = await person()
    const result = await generateWhile(a, async () => {
      await pool.query(`UPDATE session_exercises SET exercise_role = 'secondary' WHERE id = $1`, [a.slot[ANCHOR]])
    })
    expect(result.ok).toBe(false)
    expect(await stored(a)).toBeNull()
  }, 60_000)
})
