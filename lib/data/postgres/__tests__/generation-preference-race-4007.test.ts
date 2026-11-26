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
import pg from 'pg'
import { appendFileSync } from 'node:fs'
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

// The store's re-read of the preferences (inside its transaction), failing on demand. The generation's own
// start read goes through `listExercisePreferences`, which calls the real function inside its module.
const failure = vi.hoisted(() => ({ rereadFails: false }))
vi.mock('@/lib/data/postgres/slices/exercise-preferences', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/data/postgres/slices/exercise-preferences')>()
  return {
    ...real,
    readExercisePreferenceRows: (...args: Parameters<typeof real.readExercisePreferenceRows>) => {
      if (failure.rereadFails) return Promise.reject(new Error('re-read failed (test)'))
      return real.readExercisePreferenceRows(...args)
    },
  }
})

/** Measurements: printed, and appended to the file named by MEASURE_OUT when it is set (vitest's console is quiet for a passing test). */
const report = (line: string) => { console.info(line); if (process.env.MEASURE_OUT) appendFileSync(process.env.MEASURE_OUT, line + '\n') }

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
  /** The model's phase action: 'stay', or 'deload_recommended' for a deload the model writes itself (#4087). */
  let phaseAction = 'stay'
  /** Give each new person a progression style on the two lifts, so a deload has the program's numbers to record (`preDeload`, `fullSession`). */
  let styled = false

  interface Person { id: string; session: string; other: string; slot: Record<string, string> }

  const model = (slot: Person['slot']) => ({
    phase: 'accumulation', phase_action: phaseAction, deload: false, reasoning: 'test plan',
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
    if (styled) {
      const style = (await pool.query(`INSERT INTO progression_styles (user_id, name) VALUES ($1,'Style 4007') RETURNING id`, [id])).rows[0].id
      for (let n = 1; n <= 3; n++) await pool.query(`INSERT INTO style_sets (style_id, set_number, pct, reps, rest_sec) VALUES ($1,$2,75,6,150)`, [style, n])
      await pool.query(`UPDATE session_exercises SET style_id = $1 WHERE id = ANY($2::uuid[])`, [style, [slot[ANCHOR], slot[LIFT]]])
    }
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
  const generateWhile = async (p: Person, change: () => Promise<unknown>, via: import('@/lib/data/repository').WorkoutRepository = repo) => {
    mocks.answer = model(p.slot)
    const started = new Promise<void>(resolve => { mocks.started = resolve })
    let go!: () => void
    mocks.release = new Promise<void>(resolve => { go = resolve })
    const generating = generate(p.id, p.session, via, TZ)
    generating.catch(() => undefined)
    await started
    await change()
    go()
    mocks.started = null
    mocks.release = null
    return generating
  }
  /** What the row holds beside the plan: its status and when it was generated. */
  const meta = async (p: Person) => {
    const r = (await pool.query(`SELECT prescription_status AS status, prescription_generated_at AS at FROM session_periodization WHERE user_id = $1 AND program_session_id = $2`, [p.id, p.session])).rows[0]
    return { status: r?.status as string, at: r?.at as Date | null }
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
    const metaB = await meta(b)
    // A: the change lands while the model is answering.
    const raced = await generateWhile(a, () => opts.change(a))
    expect(raced).toMatchObject({ ok: true })
    const callsA = mocks.calls - callsBefore
    const storedA = await stored(a)
    return { name, generated: scrub(generated, noChange), after: scrub(after, b), storedA: scrub(storedA, a), servedA: scrub(await served(a), a), callsA, metaA: await meta(a), metaB }
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
      moves: r => {
        expect(rowOf(r.after)!.restSec).toBe(45)
        // #4007: the restated plan is re-costed, so a shorter rest reads as fewer minutes than the plan as generated.
        const minutes = (p: unknown) => (p as { estimatedSessionDurationMin: number }).estimatedSessionDurationMin
        expect(minutes(r.after)).toBeLessThan(minutes(r.generated))
      },
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

  // ---- After the first review (#4120) ----

  const rangeChain = ['12-15', '6-8', '8-10', '10-12', '4-6', '5-7', '7-9', '9-11', '3-5', '14-18']
  const chain = async (p: Person, n: number) => {
    let from: string | null = null
    for (let k = 0; k < n; k++) {
      expect(await coach(p, [{ id: `c${k}`, field: 'repRange', from, to: rangeChain[k] }])).toMatchObject({ ok: true })
      from = rangeChain[k]
    }
  }

  // The first version restated at most three times and then stored with no check, so a 4th change in that window
  // was lost. Every change made while the model answers, however many, is in force when the store commits.
  it.each([1, 3, 4, 6, 10])('%i lift changes during the model call: the stored plan is the plan for the LAST state, 1 model call', async n => {
    const a = await person()
    const b = await person()
    expect(await generateFor(b)).toMatchObject({ ok: true })
    // B: only the LAST state lands, after the store. (Applying all n to a stored plan one after another is not the
    // reference: each restate clamps what the one before left, so the reps depend on the path taken, and the plan for
    // the last state is the one made from the generated plan for that state alone.)
    expect(await coach(b, [{ id: 'last', field: 'repRange', from: null, to: rangeChain[n - 1] }])).toMatchObject({ ok: true })
    const after = scrub(await served(b), b)
    const calls = mocks.calls
    const t0 = performance.now()
    expect(await generateWhile(a, () => chain(a, n))).toMatchObject({ ok: true })
    const ms = Math.round(performance.now() - t0)
    expect(mocks.calls - calls).toBe(1)
    const storedA = scrub(await stored(a), a)
    expect(storedA).toEqual(after)
    expect(rowOf(storedA)!.liftPreference).toMatchObject({ repRange: { min: Number(rangeChain[n - 1].split('-')[0]), max: Number(rangeChain[n - 1].split('-')[1]) } })
    report(`[4007] ${n} changes during the model call (model mocked, includes the ${n} writers): request ${ms} ms`)
  }, 60_000)

  it('a change that is queued on the lift lock when the model returns lands before the store: the plan ends equal to "after the store"', async () => {
    const a = await person()
    const b = await person()
    expect(await generateFor(b)).toMatchObject({ ok: true })
    expect(await coach(b, [{ id: 'c1', field: 'repRange', from: null, to: '12-15' }])).toMatchObject({ ok: true })
    expect(await coach(b, [{ id: 'c2', field: 'restSec', from: null, to: 45 }])).toMatchObject({ ok: true })
    const after = scrub(await served(b), b)
    // A: the range lands during the model call; another writer holds the lift lock, the rest change queues behind it,
    // and the store (after the model) queues behind the rest change. The rest change commits first.
    let late: Promise<unknown> | null = null
    const holder = await pool.connect()
    try {
      const result = await generateWhile(a, async () => {
        expect(await coach(a, [{ id: 'c1', field: 'repRange', from: null, to: '12-15' }])).toMatchObject({ ok: true })
        await holder.query('BEGIN')
        await holder.query(`SELECT pg_advisory_xact_lock(hashtext('lift_writes:user'), hashtext($1))`, [a.id])
        late = coach(a, [{ id: 'c2', field: 'restSec', from: null, to: 45 }])
        late.catch(() => undefined)
        await new Promise(r => setTimeout(r, 400)) // long enough for the writer to be queued on the lift lock
        setTimeout(() => { holder.query('ROLLBACK').catch(() => undefined) }, 800) // released after the store has queued
      })
      expect(result).toMatchObject({ ok: true })
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined)
      holder.release()
    }
    expect(late).not.toBeNull()
    expect(await late).toMatchObject({ ok: true })
    expect(scrub(await stored(a), a)).toEqual(after)
  }, 60_000)

  // The first version of this PR stored in up to three attempts, each comparing the preferences and restating outside
  // the lock; a change landing after the last compare was lost, and these tests passed on it because every change in
  // them landed before the first compare. Here a change lands at EACH of the generator's reads between the model and the
  // store (the reads a restate makes, now made once before the lock is taken): on the three-attempt code that is a change
  // after each compare, and the last is lost. On this code the reads happen once and every change that landed is kept.
  it('changes that land at every read between the model and the store are all kept (fails on the three-attempt store)', async () => {
    const steps: Record<string, unknown>[][] = [
      [{ id: 'c2', field: 'repRange', from: null, to: '12-15' }],
      [{ id: 'c3', field: 'nextLoadStep', from: null, to: 'lighter' }],
      ...[60, 75, 90, 105, 120, 135].map((to, i) => [{ id: `r${i}`, field: 'restSec', from: i === 0 ? 45 : to - 15, to }]),
    ]
    const a = await person()
    const b = await person()
    expect(await generateFor(b)).toMatchObject({ ok: true })
    let landed = 0
    let inflight = 0
    let armed = false // set once the model has answered, so the generation's own start reads are not gates
    const gated = new Proxy(repo, {
      get(target, key) {
        const v = Reflect.get(target, key, target)
        if (armed && ['getLastExerciseLogsBatch', 'listPersonalRecords', 'getLastRealOneRmBatch', 'getExerciseEstimates'].includes(String(key))) {
          return async (...args: unknown[]) => {
            // One change per ROUND of reads (the reads of one restate, or of one prefetch, are started together):
            // the first read of a round lands the next change after its own read has been made.
            const first = inflight++ === 0
            try {
              const out = await (v as (...x: unknown[]) => unknown).apply(target, args)
              if (first && landed < steps.length) {
                expect(await coach(a, steps[landed++])).toMatchObject({ ok: true })
              }
              return out
            } finally { inflight-- }
          }
        }
        return typeof v === 'function' ? v.bind(target) : v
      },
    })
    const result = await generateWhile(a, async () => {
      expect(await coach(a, [{ id: 'c1', field: 'restSec', from: null, to: 45 }])).toMatchObject({ ok: true })
      armed = true
    }, gated)
    expect(result).toMatchObject({ ok: true })
    expect(landed, 'at least one change landed after the model, before the store').toBeGreaterThanOrEqual(1)
    // The reference: the same changes, in the same order, after the store.
    expect(await coach(b, [{ id: 'c1', field: 'restSec', from: null, to: 45 }])).toMatchObject({ ok: true })
    for (let i = 0; i < landed; i++) expect(await coach(b, steps[i])).toMatchObject({ ok: true })
    expect(scrub(await stored(a), a)).toEqual(scrub(await served(b), b))
    report(`[4007] changes that landed after the model call, before the store: ${landed + 1}`)
  }, 60_000)

  it('the re-read of the preferences fails: the plan is stored as generated, no restate, the preferences untouched, logged once', async () => {
    const a = await person()
    const noChange = await person()
    expect(await generateFor(noChange)).toMatchObject({ ok: true })
    const generated = scrub(await stored(noChange), noChange)
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    failure.rereadFails = true
    try {
      const calls = mocks.calls
      expect(await generateWhile(a, () => coach(a, [{ id: 'c1', field: 'repRange', from: null, to: '12-15' }]))).toMatchObject({ ok: true })
      expect(mocks.calls - calls).toBe(1)
    } finally { failure.rereadFails = false }
    const reads = log.mock.calls.filter(c => String(c[0]).includes('re-reading the lift preferences'))
    log.mockRestore()
    expect(reads).toHaveLength(1)
    // The plan as generated, byte for byte (no restate, nothing stripped); the person's range is still in force.
    expect(scrub(await stored(a), a)).toEqual(generated)
    const pref = (await pool.query(`SELECT rep_min, rep_max FROM exercise_preferences WHERE user_id = $1`, [a.id])).rows
    expect(pref).toEqual([{ rep_min: 12, rep_max: 15 }])
  }, 60_000)

  it('a read the restate needs fails before the store: the plan is stored as generated, no restate, the change untouched, logged once', async () => {
    const a = await person()
    const noChange = await person()
    expect(await generateFor(noChange)).toMatchObject({ ok: true })
    const generated = scrub(await stored(noChange), noChange)
    let armed = false
    const failing = new Proxy(repo, {
      get(target, key) {
        const v = Reflect.get(target, key, target)
        if (armed && key === 'listPersonalRecords') return () => Promise.reject(new Error('records read failed (test)'))
        return typeof v === 'function' ? v.bind(target) : v
      },
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const calls = mocks.calls
      const result = await generateWhile(a, async () => {
        expect(await coach(a, [{ id: 'c1', field: 'repRange', from: null, to: '12-15' }])).toMatchObject({ ok: true })
        armed = true
      }, failing)
      expect(result).toMatchObject({ ok: true })
      expect(mocks.calls - calls).toBe(1)
    } finally { armed = false }
    const logged = log.mock.calls.filter(c => String(c[0]).includes('reading what a restate needs'))
    log.mockRestore()
    expect(logged).toHaveLength(1)
    expect(scrub(await stored(a), a)).toEqual(generated)
    const pref = (await pool.query(`SELECT rep_min, rep_max FROM exercise_preferences WHERE user_id = $1`, [a.id])).rows
    expect(pref).toEqual([{ rep_min: 12, rep_max: 15 }])
  }, 60_000)

  // Two kinds of deload plan. A plan the model wrote as a whole deload (`deload: true`, rows with `modelDeload`,
  // `preDeload`, and a `fullSession`) is stored by the plain store, as before the PR: counted below, 0 reach the
  // preference check. A plan with ONE row deloaded for a sore muscle (`deloaded`, `preDeload`, `deload: false`) does
  // reach it. Both are raced against a change; each must store the after-store plan.
  describe.each([
    { kind: 'a whole deload the model wrote', action: 'deload_recommended', checked: 0, sore: false },
    { kind: 'a plan with a row deloaded for soreness', action: 'stay', checked: 1, sore: true },
  ])('$kind racing a change', ({ action, checked, sore }) => {
    const soreness = (p: Person) => pool.query(
      `INSERT INTO mood_logs (user_id, log_date, energy_level, sleep_quality, body_state, sore_muscles, suggested_sore_muscles) VALUES ($1,$2,'normal','good',ARRAY['sore_muscles'],ARRAY['Back'],'{}')`,
      [p.id, todayInTz(TZ)])
    const run = async (change: (p: Person) => Promise<unknown>, before0?: (p: Person) => Promise<unknown>) => {
      const before = async (p: Person) => { if (sore) await soreness(p); await before0?.(p) }
      phaseAction = action
      styled = true
      try {
        const a = await person()
        const b = await person()
        for (const p of [a, b]) await before?.(p)
        const noChange = await person()
        await before?.(noChange)
        expect(await generateFor(noChange)).toMatchObject({ ok: true })
        const generated = (await stored(noChange)) as { exercises: Record<string, unknown>[] }
        expect(generated.exercises.some(e => e.deloaded === true && e.preDeload != null), 'the plan carries deloaded rows with what Full restores').toBe(true)
        if (!sore) expect(generated.exercises.every(e => e.modelDeload === true), 'the plan carries the model-written deload rows').toBe(true)
        expect(await generateFor(b)).toMatchObject({ ok: true })
        await change(b)
        const after = await served(b)
        let checkedStores = 0
        const counted = new Proxy(repo, {
          get(target, key) {
            const v = Reflect.get(target, key, target)
            if (key === 'storePrescriptionForCurrentPreferences') return (...args: unknown[]) => { checkedStores++; return (v as (...x: unknown[]) => unknown).apply(target, args) }
            return typeof v === 'function' ? v.bind(target) : v
          },
        })
        const raced = await generateWhile(a, () => change(a), counted)
        expect(raced).toMatchObject({ ok: true })
        const storedA = (await stored(a)) as { exercises: { name: string; pct: number }[] }
        return { generated: scrub(generated, noChange) as { exercises: { name: string; pct: number }[]; fullSession?: unknown }, after: scrub(after, b), storedA: scrub(storedA, a), metaA: await meta(a), metaB: await meta(b), checkedStores }
      } finally { phaseAction = 'stay'; styled = false }
    }
    const checks = (r: Awaited<ReturnType<typeof run>>) => {
      // Whole plan equal to "landed just after the store": modelDeload, preDeload, fullSession, the note, the reasoning.
      // Counted: whether the plan reached the store's preference check (see the note above).
      expect(r.checkedStores).toBe(checked)
      expect(r.storedA).toEqual(r.after)
      expect(r.metaA.status).toBe(r.metaB.status)
      expect(r.metaA.at).not.toBeNull()
      const ex = r.storedA.exercises as Record<string, unknown>[]
      for (const e of ex.filter(x => x.deloaded)) {
        if (!sore) expect(e.modelDeload).toBe(true)
        expect(e.deloadNote).toBeTruthy()
        expect(e.preDeload).toBeTruthy()
      }
      // Never heavier than the deload the model wrote.
      for (const e of ex) {
        const was = r.generated.exercises.find(g => g.name === e.name)!
        expect(e.pct as number).toBeLessThanOrEqual(was.pct)
      }
    }
    it('a rep-range change', async () => {
      const r = await run(async p => expect(await coach(p, [{ id: 'c1', field: 'repRange', from: null, to: '12-15' }])).toMatchObject({ ok: true }))
      checks(r)
    }, 60_000)
    it('a rest change', async () => {
      const r = await run(async p => expect(await coach(p, [{ id: 'c1', field: 'restSec', from: null, to: 45 }])).toMatchObject({ ok: true }))
      checks(r)
    }, 60_000)
    it('a "Heavy" hold saved', async () => {
      const r = await run(p => checkinHeavy(p))
      checks(r)
    }, 60_000)
  })

  it('a plan held as under way (a workout of the type started during the model call): stored and served equal the after-store reference', async () => {
    const serveHeld = async (p: Person) => {
      // Age the plan out, as a plan from earlier today is when a workout is under way; the read holds it.
      await pool.query(`UPDATE session_periodization SET prescription_expires_at = now() - interval '1 hour' WHERE user_id = $1 AND program_session_id = $2`, [p.id, p.session])
      const state = (await repo.getSessionPeriodization(p.id, p.session))!
      const program = await repo.getActiveProgram(p.id)
      const programState = await import('@trainingai/shared/ai-periodization/program-phase')
      const heldState = await programState.serveStoredPrescription(repo as never, p.id, program, state, TZ)
      expect(heldState.prescriptionAgedOut, 'a workout under way holds the plan, it is not hidden').not.toBe(true)
      return scrub((await hold.holdStoredPlanUnderCheckin(p.id, p.session, repo, TZ, heldState as typeof state)).prescription, p)
    }
    const startWorkout = async (p: Person) => {
      const ws = (await pool.query(
        `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at) VALUES ($1,$2,'Upper 4007', now()) RETURNING id`, [p.id, p.session])).rows[0].id
      const el = (await pool.query(`INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, estimated_1rm, logged_at) VALUES ($1,$2,$3,100,now()) RETURNING id`, [ws, ANCHOR, lib[ANCHOR]])).rows[0].id
      await pool.query(`INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1,1,100,5)`, [el])
    }
    const change = async (p: Person) => {
      await startWorkout(p)
      expect(await coach(p, [{ id: 'c1', field: 'repRange', from: null, to: '12-15' }])).toMatchObject({ ok: true })
    }
    const a = await person()
    const b = await person()
    expect(await generateFor(b)).toMatchObject({ ok: true })
    await change(b)
    const after = await serveHeld(b)
    expect(await generateWhile(a, () => change(a))).toMatchObject({ ok: true })
    expect(scrub(await stored(a), a)).toEqual(scrub(await stored(b), b))
    expect(await serveHeld(a)).toEqual(after)
  }, 60_000)

  // How long the store holds the lift lock when the preferences moved (the longest path: re-read, restate, store).
  it('measures how long the store keeps the lift lock: 30 runs with the preferences moved, 30 with nothing moved', async () => {
    const stat = (times: number[]) => {
      const t = [...times].sort((x, y) => x - y)
      return { median: (t[14] + t[15]) / 2, worst: t[29] }
    }
    const measure = async (moved: boolean) => {
      const times: number[] = []
      const timed = new Proxy(repo, {
        get(target, key) {
          const v = Reflect.get(target, key, target)
          if (key === 'storePrescriptionForCurrentPreferences') {
            return async (...args: unknown[]) => {
              const t0 = performance.now()
              try { return await (v as (...x: unknown[]) => unknown).apply(target, args) } finally { times.push(performance.now() - t0) }
            }
          }
          return typeof v === 'function' ? v.bind(target) : v
        },
      })
      for (let k = 0; k < 30; k++) {
        const a = await person()
        const r = moved
          ? await generateWhile(a, () => coach(a, [{ id: 'c1', field: 'repRange', from: null, to: '12-15' }]), timed)
          : (mocks.answer = model(a.slot), await generate(a.id, a.session, timed, TZ))
        expect(r).toMatchObject({ ok: true })
      }
      return times
    }
    const movedTimes = await measure(true)
    const unmovedTimes = await measure(false)
    const m = stat(movedTimes), u = stat(unmovedTimes)
    report(`[4007] lift lock held by the store, 30 runs each: moved median ${m.median.toFixed(1)} ms worst ${m.worst.toFixed(1)} ms; unmoved median ${u.median.toFixed(1)} ms worst ${u.worst.toFixed(1)} ms`)
    expect(movedTimes).toHaveLength(30)
    expect(unmovedTimes).toHaveLength(30)
    expect(m.worst).toBeLessThan(2000)
    expect(u.worst).toBeLessThan(2000)
  }, 180_000)

  it('counts the statements and the time of one generation (no change made meanwhile), 20 runs', async () => {
    const counts: number[] = []
    const times: number[] = []
    const realQuery = pg.Client.prototype.query
    let n = 0
    ;(pg.Client.prototype as any).query = function (this: pg.Client, ...args: unknown[]) { n++; return (realQuery as any).apply(this, args) } // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      for (let k = 0; k < 20; k++) {
        const a = await person()
        mocks.answer = model(a.slot)
        n = 0
        const t0 = performance.now()
        expect(await generate(a.id, a.session, repo, TZ)).toMatchObject({ ok: true })
        times.push(performance.now() - t0)
        counts.push(n)
      }
    } finally { pg.Client.prototype.query = realQuery }
    times.sort((x, y) => x - y)
    report(`[4007] one generation, nothing moved, 20 runs: statements per run ${counts.join(",")}, median ${((times[9] + times[10]) / 2).toFixed(1)} ms`)
    expect(counts.length).toBe(20)
  }, 120_000)

  const busyRows = async (p: Person) =>
    Number((await pool.query(`SELECT count(*)::int AS n FROM error_events WHERE user_id = $1 AND message LIKE 'program write gave up on a lock%'`, [p.id])).rows[0].n)
  /** Hold the person's lift lock from another connection for `ms`, then release it. */
  const holdLock = async (p: Person, ms: number) => {
    const holder = await pool.connect()
    await holder.query('BEGIN')
    await holder.query(`SELECT pg_advisory_xact_lock(hashtext('lift_writes:user'), hashtext($1))`, [p.id])
    const done = new Promise<void>(resolve => setTimeout(() => { holder.query('ROLLBACK').catch(() => undefined).finally(() => { holder.release(); resolve() }) }, ms))
    return done
  }

  it('a generation that finds the lift lock busy from its start writes one error row, not one for each of its two waits', async () => {
    const { lockWait } = await import('@/lib/coach/lock-wait')
    const was = lockWait.ms
    lockWait.ms = 300
    try {
      // The lock is held from before the generation starts: its earlier program write waits and gives up (a row, as on
      // `main`), then the store waits and gives up (`reportOncePerMs` skips its row, the request already has one).
      const a = await person()
      const released = holdLock(a, 1500)
      await new Promise(r => setTimeout(r, 100))
      expect(await generateFor(a)).toMatchObject({ ok: true })
      await released
      await new Promise(r => setTimeout(r, 200)) // the row is written without awaiting
      expect(await busyRows(a)).toBe(1)
    } finally { lockWait.ms = was }
  }, 60_000)

  // What a request costs when the lift lock is held by another writer for 10 s (run by hand: `MEASURE4007=1`).
  it.skipIf(!process.env.MEASURE4007)('measures a generation with the lift lock held 10 s by another connection', async () => {
    const a = await person()
    const released = holdLock(a, 10_000)
    await new Promise(r => setTimeout(r, 100))
    const t0 = performance.now()
    expect(await generateFor(a)).toMatchObject({ ok: true })
    const ms = Math.round(performance.now() - t0)
    await released
    await new Promise(r => setTimeout(r, 300))
    report(`[4007] lock held 10 s: request ${ms} ms, ${await busyRows(a)} busy error rows`)
  }, 60_000)
})
