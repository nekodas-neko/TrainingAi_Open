// #4097 against a real Postgres. A Preview workout sends nothing while it is trained: the phone copies
// the plan into the workout record at Start and uploads one `workout_log` per exercise and a
// `complete_workout` at Finish (`pushMutations`, as `/api/sync/push` calls it). So between Start and
// Finish the server may replace the plan the workout is being trained on, three ways:
//   A. the type's plan expires and is planned again;
//   B. another session type moves the program's phase, which voids this type's plan;
//   C. a one-day deload ends at local midnight and the type is planned again.
// Each is run here, then the finish is uploaded exactly as the native queue builds it, with the
// plan's identity (`planGeneratedAt`, new) and without it (an older Preview build). The model is
// mocked: 0 real requests. Runs only with DATABASE_URL. Every row it adds is removed in `afterAll`
// (the library rows by id).
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { dateStrMidnightInTz, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { programMoveMark, programPhaseView } from '@trainingai/shared/ai-periodization/program-phase'
import { resetRegenerationAttempts } from '@trainingai/shared/ai-periodization/pending-plan-adoption'
import { DELOAD_FLOOR } from '@trainingai/shared/ai-periodization/phase-guards'
import { repCompletionFromSetLogs } from '@trainingai/shared/ai-periodization/rep-completion'
import type { WorkoutRepository } from '@/lib/data/repository'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'
import { classifyDay } from '@/app/api/weekly-stats/classify-day'

const model = vi.hoisted(() => ({ answer: null as Record<string, unknown> | null, calls: 0, hold: null as null | Promise<void> }))
vi.mock('ai', async orig => ({
  ...(await orig<typeof import('ai')>()),
  generateObject: async () => {
    model.calls++
    if (model.hold) await model.hold
    if (!model.answer) throw new Error('no model in this test')
    return { object: structuredClone(model.answer) }
  },
}))
vi.mock('@/lib/ai/instrument', async orig => ({
  ...(await orig<typeof import('@/lib/ai/instrument')>()),
  loggedGenerateObject: async (_opts: unknown, run: (signal: undefined, settings: object) => Promise<unknown>) => run(undefined, {}),
}))
const authUser = vi.hoisted(() => ({ current: null as null | { id: string; timezone: string } }))
vi.mock('@/auth', () => ({ auth: async () => (authUser.current ? { user: authUser.current } : null) }))
const regen = vi.hoisted(() => ({ calls: 0 }))
vi.mock('@trainingai/shared/ai-periodization/regenerate-in-background', () => ({
  regeneratePrescriptionInBackground: () => { regen.calls++ },
}))

const canRun = !!process.env.DATABASE_URL
const TZ = 'America/Chicago'
const USER = '00000000-0000-4000-8000-000000004097'
const LIFT = 'Finish Squat 4097'
const ACC = 'Finish Curl 4097'
const HOUR = 3_600_000

describe.skipIf(!canRun)('a finished Preview workout is recorded against the plan it trained (#4097)', () => {
  let pool: import('pg').Pool
  let repo: WorkoutRepository
  let generate: typeof import('@trainingai/shared/ai-periodization/generate-prescription').generatePrescriptionForSession
  let workoutData: typeof import('@/app/api/workout-data/route').GET
  const libIds: string[] = []
  let program: string, push: string, legs: string, pushLift: string

  const seed = async () => {
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [USER, 'finish-4097@example.com', TZ])
    program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, auto_apply_prescriptions, created_at)
       VALUES ($1,'Finish test','ai_dynamic',true,'strength',false, now() - interval '120 days') RETURNING id`, [USER])).rows[0].id
    const mk = async (name: string, position: number) =>
      (await pool.query(`INSERT INTO program_sessions (program_id, name, position, time_budget_minutes) VALUES ($1,$2,$3,90) RETURNING id`, [program, name, position])).rows[0].id as string
    push = await mk('Push 4097', 0)
    legs = await mk('Legs 4097', 1)
    const ex = async (session: string, name: string, libId: string, position: number, role: string, muscle: string) =>
      (await pool.query(
        `INSERT INTO session_exercises (session_id, exercise_name, exercise_id, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [session, name, libId, position, role, [muscle]])).rows[0].id as string
    pushLift = await ex(push, LIFT, libIds[0], 0, 'primary', 'quads')
    await ex(push, ACC, libIds[1], 1, 'accessory', 'biceps')
    await ex(legs, LIFT, libIds[0], 0, 'primary', 'quads')

    // Accumulation began two local weeks ago; Push has been trained twice since (so the count is 2).
    const today = todayInTz(TZ)
    const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7
    const startDay = shiftDateStr(shiftDateStr(today, -weekday), -14)
    const phaseStart = dateStrMidnightInTz(startDay, TZ)
    for (let w = 0; w < 2; w++) {
      const at = new Date(dateStrMidnightInTz(shiftDateStr(startDay, 2 + 4 * w), TZ).getTime() + 12 * HOUR)
      const ws = (await pool.query(
        `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Push 4097',$3,$4) RETURNING id`,
        [USER, push, at, new Date(at.getTime() + HOUR)])).rows[0].id
      const el = (await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, estimated_1rm, logged_at) VALUES ($1,$2,$3,100,$4) RETURNING id`,
        [ws, LIFT, libIds[0], at])).rows[0].id
      await pool.query(
        `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, planned_reps, planned_weight_kg, planned_pct, intensity_pct, rest_time_sec, planned_rest_sec, rpe, rpe_source)
         VALUES ($1,1,72,5,5,72,72,72,180,180,7,'rated')`, [el])
    }
    for (const s of [push, legs]) {
      await pool.query(
        `INSERT INTO session_periodization (user_id, program_session_id, phase, phase_started_at, sessions_in_phase, baseline_complete, prescription_status, pending_transition)
         VALUES ($1,$2,'accumulation',$3,$4,true,'consumed',$5::jsonb)`,
        [USER, s, phaseStart, s === push ? 2 : 0, JSON.stringify(programMoveMark('accumulation'))])
    }
  }

  const planOf = (kind: 'full' | 'deload', pct: number, sets: number, reps: number) => ({
    phase: kind === 'deload' ? 'deload' : 'accumulation',
    phaseAction: kind === 'deload' ? 'deload_recommended' : 'stay',
    reasoning: `${kind} ${pct}`, confidence: 0.9, deload: kind === 'deload', estimatedSessionDurationMin: 40, weeklyVolumeContribution: {},
    exercises: [{ sessionExerciseId: pushLift, name: LIFT, sets, reps, pct, restSec: 180, ...(kind === 'deload' ? { deloaded: true } : {}) }],
  })
  const modelAnswer = (pct: number, sets: number, reps: number) => ({
    phase: 'accumulation', phase_action: 'stay', deload: false, reasoning: 'Replacement.',
    exercises: [{ session_exercise_id: pushLift, name: LIFT, sets, reps, pct, rest_sec: 180 }],
  })
  // The plan the phone was served at Start. Generated at a whole millisecond so its identity survives the wire.
  const T1 = () => new Date(Math.floor((Date.now() - 3 * HOUR) / 1000) * 1000 + 123)
  const storePlan = (plan: object, status: string, generatedAt: Date, expiresSql: string) => pool.query(
    `UPDATE session_periodization SET prescription=$2::jsonb, prescription_status=$3, prescription_generated_at=$4, prescription_expires_at=${expiresSql}
     WHERE user_id=$1 AND program_session_id=$5`, [USER, JSON.stringify(plan), status, generatedAt, push])

  type Row = {
    prescription: (AiPrescription & { sessionsInPhaseAtPlan?: number }) | null; prescription_status: string
    prescription_generated_at: Date | null; sessions_in_phase: number; last_session_ran_prescription: boolean | null; phase: string
  }
  const pushRow = async () => (await pool.query(
    `SELECT prescription, prescription_status, prescription_generated_at, sessions_in_phase, last_session_ran_prescription, phase
     FROM session_periodization WHERE user_id=$1 AND program_session_id=$2`, [USER, push])).rows[0] as Row

  /** What the native queue uploads: one `workout_log` for the lift, then `complete_workout`. `trained` is the
   *  plan the phone copied at Start (its numbers go in the set payloads, as `mutationFor` sends them). */
  const upload = async (
    trained: { pct: number; sets: number; reps: number; deload?: boolean }, reps: number[], identity: Date | null | undefined, agoMs = 0,
    /** `planPhase`: the phase the phone says the plan was made for. `explicitNone`: the phone says it trained no
     *  plan (`planGeneratedAt: null`). `omitMode`: an old payload with no `intensityMode`. `startedAtMs`: when the
     *  workout started (default 40 minutes before it finished). */
    opts: { planPhase?: string; explicitNone?: boolean; omitMode?: boolean; startedAtMs?: number; workoutSessionId?: string } = {},
  ) => {
    const wsId = opts.workoutSessionId ?? randomUUID()
    // `agoMs`: the workout was finished offline this long ago and is uploaded now.
    const now = Date.now() - agoMs
    const localDay = shiftDateStr(todayInTz(TZ), 0) === todayInTz(TZ) && agoMs === 0 ? todayInTz(TZ) : new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(now))
    const n = trained.sets
    const kg = Math.round(trained.pct) // 100 kg basis
    const logPayload = {
      sessionName: 'Push 4097', sessionId: push, workoutSessionId: wsId, exerciseLogId: randomUUID(),
      setLogIds: Array.from({ length: n }, () => randomUUID()), exercise: LIFT,
      weights: Array(n).fill(kg), reps, sets: n, localDate: localDay, workoutStartedAt: opts.startedAtMs ?? now - 40 * 60_000,
      setEndTimes: Array.from({ length: n }, (_, i) => now - (n - i) * 120_000),
      progressionStyle: Array.from({ length: n }, () => ({ pct: trained.pct, reps: trained.reps, restSec: 180 })),
      plannedWeights: Array(n).fill(kg), prescriptionBasisKg: 100,
      muscleGroups: ['quads'], exerciseDeloaded: trained.deload === true,
      ...(opts.omitMode ? {} : { intensityMode: trained.deload ? 'deload' : 'full' }), wasOverride: false,
    }
    const complete = {
      workoutSessionId: wsId, completedAtMs: now,
      ...(identity ? { planGeneratedAt: identity.toISOString() } : opts.explicitNone ? { planGeneratedAt: null } : {}),
      ...(opts.planPhase ? { planPhase: opts.planPhase } : {}),
    }
    const res = await repo.pushMutations(USER, [
      { id: randomUUID(), domain: 'workout_log', date: localDay, payload: logPayload },
      { id: randomUUID(), domain: 'complete_workout', date: localDay, payload: complete },
    ])
    expect(res.errors).toEqual([])
    // The completion's counter bump is fire-and-forget (advisory); wait for it.
    await new Promise(r => setTimeout(r, 400))
    return wsId
  }

  const afterFinish = async (wsId: string) => {
    const row = await pushRow()
    const sets = await repo.getSetLogsForSessions([wsId])
    const stored = (await pool.query(
      `SELECT sl.planned_reps, sl.planned_weight_kg, sl.planned_pct, el.estimated_1rm
       FROM set_logs sl JOIN exercise_logs el ON el.id = sl.exercise_log_id WHERE el.workout_session_id = $1 ORDER BY sl.set_number`, [wsId])).rows
    const ws = (await pool.query(`SELECT phase_type, intensity_mode, was_override FROM workout_sessions WHERE id = $1`, [wsId])).rows[0]
    return {
      status: row.prescription_status, hasPlan: row.prescription != null, generatedAtMs: row.prescription_generated_at?.getTime() ?? null,
      sessionsInPhase: row.sessions_in_phase, ranPrescription: row.last_session_ran_prescription, phase: row.phase,
      repRate: repCompletionFromSetLogs(sets).rate, plannedReps: stored.map(r => r.planned_reps), plannedKg: stored.map(r => Number(r.planned_weight_kg)),
      plannedPct: stored.map(r => Number(r.planned_pct)), e1rm: Number(stored[0].estimated_1rm), wsPhase: ws.phase_type as string | null, wsMode: ws.intensity_mode as string | null,
    }
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    ;({ generatePrescriptionForSession: generate } = await import('@trainingai/shared/ai-periodization/generate-prescription'))
    ;({ GET: workoutData } = await import('@/app/api/workout-data/route'))
    for (const [name, muscle, equipment] of [[LIFT, 'quads', 'barbell'], [ACC, 'biceps', 'cable']]) {
      libIds.push((await pool.query(
        `INSERT INTO exercise_library (name, equipment, muscles) VALUES ($1, ARRAY[$3], $2::jsonb)
         ON CONFLICT (name) DO UPDATE SET equipment = EXCLUDED.equipment RETURNING id`,
        [name, JSON.stringify([{ muscle, role: 'main' }]), equipment])).rows[0].id)
    }
  })
  beforeEach(async () => { model.calls = 0; model.hold = null; regen.calls = 0; resetRegenerationAttempts(); await seed() })
  afterAll(async () => {
    await pool?.query(`DELETE FROM users WHERE id = $1`, [USER])
    if (libIds.length > 0) await pool?.query(`DELETE FROM exercise_library WHERE id = ANY($1::uuid[])`, [libIds])
  })

  // ---- the three ways the stored plan changes while the workout is being trained ----
  /** A: P1 expires mid-workout and the type is planned again (P2, 80 %, 4 x 3). Returns P1's identity. */
  const replanAfterExpiry = async () => {
    const t1 = T1()
    await storePlan(planOf('full', 70, 3, 5), 'auto_applied', t1, "now() - interval '10 minutes'")
    model.answer = modelAnswer(80, 4, 3)
    const res = await generate(USER, push, repo, TZ)
    expect(res.ok).toBe(true)
    return t1
  }
  /** B: another type moves the program's phase; Push's plan is voided (and, when `replan`, made again). */
  const phaseMovedByAnotherType = async (replan: boolean) => {
    const t1 = T1()
    await storePlan(planOf('full', 70, 3, 5), 'auto_applied', t1, "now() + interval '3 days'")
    await repo.advanceProgramPhase(USER, legs, 'intensification')
    if (replan) { model.answer = { ...modelAnswer(80, 4, 3), phase: 'intensification' }; await generate(USER, push, repo, TZ) }
    return t1
  }
  /** C: a one-day deload (50 %, 2 x 6) ends at local midnight; the type is planned again (P2, 80 %, 4 x 3). */
  const deloadEndsAtMidnight = async () => {
    const t1 = T1()
    await storePlan(planOf('deload', 50, 2, 6), 'auto_applied', t1, "now() - interval '5 minutes'")
    model.answer = modelAnswer(80, 4, 3)
    await generate(USER, push, repo, TZ)
    return t1
  }


  const FULL = { pct: 70, sets: 3, reps: 5 }
  const DELOAD = { pct: 50, sets: 2, reps: 6, deload: true }
  const serve = async () => {
    authUser.current = { id: USER, timezone: TZ }
    const url = `http://localhost/api/workout-data?session=${push}`
    const res = await workoutData(Object.assign(new Request(url), { nextUrl: new URL(url) }) as never)
    return res.json() as Promise<{ aiPrescriptionPending: boolean; prescriptionGeneratedAt?: string; exercises: Array<{ sessionExerciseId: string; progressionStyle: Array<{ pct: number }> | null }> }>
  }
  const both = async (run: () => Promise<Date>, trained: typeof FULL, reps: number[]) => {
    const out = []
    for (const withIdentity of [true, false]) {
      await seed(); model.calls = 0; regen.calls = 0
      const t1 = await run()
      const mid = await pushRow()
      const ws = await upload(trained, reps, withIdentity ? t1 : null)
      out.push({ withIdentity, t1, mid, after: await afterFinish(ws), modelCallsAtFinish: model.calls })
    }
    return { identity: out[0], old: out[1] }
  }

  describe('Part 1: what the server does at Finish today (an older build sends no identity)', () => {
    it('A, the plan expires and is planned again: the replacement is spent, the count moves once, and every reading uses the phone\'s numbers', async () => {
      const { old } = await both(replanAfterExpiry, FULL, [5, 5, 4])
      // Q1. P2 (made mid-workout, 80 % 4 x 3, never seen) is the stored plan; the finish spends it: status
      // 'consumed', content kept, its own generation time. P1 (the trained plan) was already gone.
      expect(old.mid.prescription_status).toBe('auto_applied')
      expect(old.mid.prescription_generated_at!.getTime()).toBeGreaterThan(old.t1.getTime())
      expect(old.after.status).toBe('consumed')
      expect(old.after.generatedAtMs).toBe(old.mid.prescription_generated_at!.getTime())
      // The counter is the completed workouts: 2 before, 3 after, once. The replacement did not count (it was
      // stored with the count at its making, 2), and the finish did not count twice.
      expect(old.mid.prescription!.sessionsInPhaseAtPlan).toBe(2)
      expect(old.after.sessionsInPhase).toBe(3)
      // Q2. Per-set planned numbers are the phone's (5 reps, 70 kg, 70 %), not the replacement's (3 reps, 80 %).
      expect(old.after.plannedReps).toEqual([5, 5, 5])
      expect(old.after.plannedKg).toEqual([70, 70, 70])
      expect(old.after.plannedPct).toEqual([70, 70, 70])
      expect(old.after.repRate).toBeCloseTo(14 / 15, 6) // 5+5+4 done of 5+5+5 asked; against the replacement it would read 14/9
      expect(old.after.e1rm).toBe(99) // 70 kg x 5 at the trained plan's bar, basis 100 kg
      expect(old.after.ranPrescription).toBe(true)
      // Q3. Not left applied: the next open asks for a new plan, and that costs one model call. The one made
      // mid-workout was spent on a plan nobody trained: 1 wasted call, which only a heartbeat could avoid.
      expect(old.modelCallsAtFinish).toBe(1)
      const served = await serve()
      expect(served.aiPrescriptionPending).toBe(true)
      expect(served.prescriptionGeneratedAt).toBeUndefined()
      expect(regen.calls).toBe(1)
    })

    it('B, another type moves the phase and voids the plan: an older payload counts as on main (it was completed after the move); the voided plan leaves "ran a plan" false (the gap)', async () => {
      const { old } = await both(() => phaseMovedByAnotherType(false), FULL, [5, 5, 4])
      expect(old.mid.prescription).toBeNull()
      expect(old.mid.prescription_status).toBe('consumed')
      expect(old.after.phase).toBe('intensification')
      expect(old.after.sessionsInPhase).toBe(1) // no planPhase: the app did not say, so main's rule (#3799, completed after the move)
      expect(old.after.repRate).toBeCloseTo(14 / 15, 6)
      expect(old.after.ranPrescription).toBe(false) // the stored plan is gone, so the finish reads "no plan was run"
      expect(old.modelCallsAtFinish).toBe(0) // nothing was made mid-workout: nothing wasted
    })

    it('B, voided and then planned again before the finish: the replacement (new phase) is the one spent', async () => {
      const { old } = await both(() => phaseMovedByAnotherType(true), FULL, [5, 5, 4])
      expect(old.mid.prescription!.phase).toBe('intensification')
      expect(old.after.status).toBe('consumed')
      expect(old.after.sessionsInPhase).toBe(1) // an older payload: as on main
      expect(old.after.plannedReps).toEqual([5, 5, 5])
      expect(old.after.ranPrescription).toBe(true)
      expect(old.modelCallsAtFinish).toBe(1) // that plan was never trained: 1 wasted
    })

    it('C, a one-day deload ends at midnight and the type is planned again: recorded as the deload it was trained as', async () => {
      const { old } = await both(deloadEndsAtMidnight, DELOAD, [6, 6])
      expect(old.after.status).toBe('consumed')
      expect(old.after.sessionsInPhase).toBe(3) // the deload day counts once; the full-load replacement did not
      expect(old.after.wsMode).toBe('deload') // from the log's own intensityMode
      expect(old.after.e1rm).toBe(0) // a deload set is never estimated (exerciseDeloaded from the phone)
      expect(old.after.plannedPct).toEqual([50, 50])
      expect(old.after.repRate).toBe(1)
      expect(old.after.ranPrescription).toBe(true)
      expect(old.modelCallsAtFinish).toBe(1)
    })
  })

  describe('Part 2: the finish carries the identity of the plan it trained', () => {
    it('with the identity the voided case reads "ran a plan"; every other recorded figure is the same as without it', async () => {
      const b = await both(() => phaseMovedByAnotherType(false), FULL, [5, 5, 4])
      expect(b.identity.after.ranPrescription).toBe(true)
      expect(b.old.after.ranPrescription).toBe(false)
      const { ranPrescription: _a, ...withId } = b.identity.after
      const { ranPrescription: _b, ...without } = b.old.after
      expect(withId).toEqual(without)
      // The same on the other two ways: nothing else differs between an old build and a new one.
      for (const [run, trained, reps] of [[replanAfterExpiry, FULL, [5, 5, 4]], [deloadEndsAtMidnight, DELOAD, [6, 6]]] as const) {
        const r = await both(run, trained, [...reps])
        const { generatedAtMs: _g1, ...x } = r.identity.after
        const { generatedAtMs: _g2, ...y } = r.old.after
        expect(x).toEqual(y)
      }
    })

    it('a plan that was not replaced behaves exactly as before, with or without the identity', async () => {
      const r = await both(async () => {
        const t1 = T1()
        await storePlan(planOf('full', 70, 3, 5), 'auto_applied', t1, "now() + interval '3 days'")
        return t1
      }, FULL, [5, 5, 4])
      const { generatedAtMs: g1, ...x } = r.identity.after
      const { generatedAtMs: g2, ...y } = r.old.after
      expect(x).toEqual(y)
      expect(g1).toBe(r.identity.t1.getTime()) // the stored plan was the trained one, and is the one spent
      expect(g2).toBe(r.old.t1.getTime())
      expect(r.identity.after).toMatchObject({ status: 'consumed', sessionsInPhase: 3, ranPrescription: true, plannedReps: [5, 5, 5], e1rm: 99 })
      expect(r.identity.modelCallsAtFinish).toBe(0)
    })

    it('an identity from the future (after the finish) is not believed', async () => {
      await seed()
      const t1 = await phaseMovedByAnotherType(false)
      const ws = await upload(FULL, [5, 5, 4], new Date(Date.now() + 5 * HOUR))
      expect((await afterFinish(ws)).ranPrescription).toBe(false)
      void t1
    })

    it('a workout finished offline yesterday and uploaded today, after a one-day deload ended and a new plan was made', async () => {
      await seed()
      const t1 = T1()
      // The deload was trained yesterday evening, finished offline at 21:00 local. Midnight ended it, and today
      // the type was planned again. The upload arrives now.
      await storePlan(planOf('deload', 50, 2, 6), 'auto_applied', t1, "now() - interval '5 minutes'")
      model.answer = modelAnswer(80, 4, 3)
      await generate(USER, push, repo, TZ)
      const midnight = dateStrMidnightInTz(todayInTz(TZ), TZ).getTime()
      const ws = await upload(DELOAD, [6, 6], t1, Date.now() - (midnight - 3 * HOUR))
      const after = await afterFinish(ws)
      const done = (await pool.query(`SELECT completed_at, started_at FROM workout_sessions WHERE id = $1`, [ws])).rows[0]
      expect(done.completed_at.getTime()).toBeLessThan(midnight) // dated to yesterday, not to the upload
      expect(after).toMatchObject({ status: 'consumed', sessionsInPhase: 3, ranPrescription: true, wsMode: 'deload', e1rm: 0, plannedPct: [50, 50] })
    })

    it('the finish racing a generation for the same type counts the session once', async () => {
      await seed()
      const t1 = T1()
      await storePlan(planOf('full', 70, 3, 5), 'auto_applied', t1, "now() - interval '10 minutes'")
      model.answer = modelAnswer(80, 4, 3)
      let release!: () => void
      model.hold = new Promise<void>(r => { release = r })
      const generation = generate(USER, push, repo, TZ)
      for (let i = 0; i < 100 && model.calls === 0; i++) await new Promise(r => setTimeout(r, 20))
      expect(model.calls).toBe(1) // the generation is waiting on the model
      const ws = await upload(FULL, [5, 5, 4], t1)
      release()
      await generation
      const after = await afterFinish(ws)
      expect(after.sessionsInPhase).toBe(3) // once: not 4, not 2
      expect(after.ranPrescription).toBe(true)
      // #4113: the generation read its signals before the finish, so its plan is made without that workout
      // and is not stored. The slot stays spent and the next open makes a new plan (main: 'auto_applied').
      expect(after.status).toBe('consumed')
    })

    it('the plan the phone is served carries its identity while it drives the bar, and none otherwise', async () => {
      await seed()
      const t1 = T1()
      await storePlan(planOf('full', 70, 3, 5), 'auto_applied', t1, "now() + interval '3 days'")
      expect((await serve()).prescriptionGeneratedAt).toBe(t1.toISOString())
      await pool.query(`UPDATE session_periodization SET prescription=NULL, prescription_status='consumed', prescription_generated_at=NULL WHERE user_id=$1 AND program_session_id=$2`, [USER, push])
      expect((await serve()).prescriptionGeneratedAt).toBeUndefined()
    })
  })

  // ---- after review: what was trained decides what is recorded and what is counted ----
  describe('After review: a phase that moves while the workout is being trained', () => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
    const record = async (wsId: string) => {
      const ws = (await pool.query(`SELECT phase_type, intensity_mode FROM workout_sessions WHERE id = $1`, [wsId])).rows[0]
      const prs = (await pool.query(`SELECT estimated_1rm AS e FROM personal_records WHERE user_id = $1 AND exercise_name = $2`, [USER, LIFT])).rows
      return { phaseType: ws.phase_type as string | null, mode: ws.intensity_mode as string | null, pr: prs.length ? Number(prs[0].e) : null }
    }
    /** What the next read does to the count: reconcile must agree with the finish, or it undoes it. */
    const reconciled = async () => { await repo.reconcileSessionsInPhase(USER, program); return (await pushRow()).sessions_in_phase }
    const startNow = async () => { await sleep(15); return Date.now() }

    it('into a deload: the full workout is recorded full (1RM 99, a record) and is not one of the deload\'s two sessions', async () => {
      const t1 = T1()
      await storePlan(planOf('full', 70, 3, 5), 'auto_applied', t1, "now() + interval '3 days'")
      const started = Date.now() - 1000
      await sleep(15)
      await repo.advanceProgramPhase(USER, legs, 'deload') // another type moves the program while Push is being trained
      expect((await pushRow()).phase).toBe('deload')
      const ws = await upload(FULL, [5, 5, 4], t1, 0, { planPhase: 'accumulation', startedAtMs: started })
      const after = await afterFinish(ws)
      expect(after.wsPhase).toBeNull() // main: 'deload'
      expect(after.wsMode).toBe('full')
      expect(after.e1rm).toBe(99) // main: 0
      expect((await record(ws)).pr).toBe(99) // main: no personal record
      expect(after.sessionsInPhase).toBe(0) // main: 1, one of the deload's two
      expect(await reconciled()).toBe(0) // the next read keeps it
      // Two real deload sessions (started after the move) finish the deload's two; main would have had it at one.
      for (let i = 1; i <= DELOAD_FLOOR; i++) {
        await upload(DELOAD, [6, 6], null, 0, { startedAtMs: await startNow(), explicitNone: true })
        expect((await pushRow()).sessions_in_phase).toBe(i)
      }
      expect(await reconciled()).toBe(DELOAD_FLOOR)
    })

    it('into a deload, an older build (no intensityMode, no identity): recorded as before', async () => {
      const t1 = T1()
      await storePlan(planOf('full', 70, 3, 5), 'auto_applied', t1, "now() + interval '3 days'")
      await repo.advanceProgramPhase(USER, legs, 'deload')
      const ws = await upload(FULL, [5, 5, 4], null, 0, { omitMode: true })
      const after = await afterFinish(ws)
      expect(after.wsPhase).toBe('deload') // the stored phase decides when the upload does not say, as today
      expect(after.e1rm).toBe(0)
    })

    it('out of a deload: the deload is recorded as one (no 1RM, no record) and does not count toward the new phase', async () => {
      await repo.advanceProgramPhase(USER, legs, 'deload')
      const t1 = T1()
      await storePlan(planOf('deload', 50, 2, 6), 'auto_applied', t1, "now() + interval '3 days'")
      const started = await startNow()
      await sleep(15)
      await repo.advanceProgramPhase(USER, legs, 'accumulation') // the program leaves the deload mid-workout
      const before = (await pushRow()).sessions_in_phase
      const ws = await upload(DELOAD, [6, 6], t1, 0, { planPhase: 'deload', startedAtMs: started })
      const after = await afterFinish(ws)
      expect(after.phase).toBe('accumulation')
      expect(after.wsPhase).toBe('deload') // main: null
      expect(after.e1rm).toBe(0)
      expect((await record(ws)).pr).toBeNull()
      expect(after.sessionsInPhase).toBe(before) // main: +1 in the phase it did not train in
      expect(await reconciled()).toBe(before)
    })

    it('accumulation to intensification mid-workout: the session stays with the phase it trained', async () => {
      const t1 = T1()
      await storePlan(planOf('full', 70, 3, 5), 'auto_applied', t1, "now() + interval '3 days'")
      const started = Date.now() - 1000
      await sleep(15)
      await repo.advanceProgramPhase(USER, legs, 'intensification')
      const ws = await upload(FULL, [5, 5, 4], t1, 0, { planPhase: 'accumulation', startedAtMs: started })
      const after = await afterFinish(ws)
      expect(after.phase).toBe('intensification')
      expect(after.sessionsInPhase).toBe(0) // main: 1
      expect(after.e1rm).toBe(99)
      expect(await reconciled()).toBe(0)
    })

    it('a plan of another phase than the stored one does not count, even for a workout that started after the move (a stale phone)', async () => {
      await repo.advanceProgramPhase(USER, legs, 'intensification')
      const started = await startNow() // the phone started it after the move, on a plan it was served before
      const ws = await upload(FULL, [5, 5, 4], new Date(started - 3 * HOUR), 0, { planPhase: 'accumulation', startedAtMs: started })
      expect((await afterFinish(ws)).sessionsInPhase).toBe(0)
      // The same workout on a plan of the stored phase counts.
      const ws2 = await upload(FULL, [5, 5, 4], new Date(started - 3 * HOUR), 0, { planPhase: 'intensification', startedAtMs: started })
      expect((await afterFinish(ws2)).sessionsInPhase).toBe(1)
      void ws2
    })

    it('control, nothing moved: counted once, recorded full, 1RM 99, a record, the flag true', async () => {
      const t1 = T1()
      await storePlan(planOf('full', 70, 3, 5), 'auto_applied', t1, "now() + interval '3 days'")
      const ws = await upload(FULL, [5, 5, 4], t1, 0, { planPhase: 'accumulation' })
      const after = await afterFinish(ws)
      expect(after).toMatchObject({ sessionsInPhase: 3, wsPhase: null, wsMode: 'full', e1rm: 99, ranPrescription: true, status: 'consumed' })
      expect((await record(ws)).pr).toBe(99)
      expect(await reconciled()).toBe(3)
    })

    it('the same finish uploaded twice counts once', async () => {
      const t1 = T1()
      await storePlan(planOf('full', 70, 3, 5), 'auto_applied', t1, "now() + interval '3 days'")
      const id = randomUUID()
      await upload(FULL, [5, 5, 4], t1, 0, { planPhase: 'accumulation', workoutSessionId: id })
      await upload(FULL, [5, 5, 4], t1, 0, { planPhase: 'accumulation', workoutSessionId: id })
      expect((await pushRow()).sessions_in_phase).toBe(3)
    })

    it('the aligned program\'s window uses the same rule: a plan of the phase before never counts; an older payload counts as on main', async () => {
      const t1 = T1()
      await storePlan(planOf('full', 70, 3, 5), 'auto_applied', t1, "now() + interval '3 days'")
      const started = Date.now() - 1000
      await sleep(15)
      await repo.advanceProgramPhase(USER, legs, 'deload')
      const view = async () => {
        const rows = await repo.listSessionPeriodizationForProgram(USER, program)
        const done = await repo.listProgramCompletions(USER, program, new Date(Date.now() - 30 * 86_400_000))
        return { done, view: programPhaseView(rows, done, TZ) }
      }
      const ws = await upload(FULL, [5, 5, 4], t1, 0, { planPhase: 'accumulation', startedAtMs: started })
      const a = await view()
      expect(a.done.find(c => c.programSessionId === push && c.planPhase === 'accumulation')).toBeTruthy() // the completion carries the stored plan phase
      expect(a.view.aligned).toBe(true)
      expect(a.view.trainedThisWeek.has(push)).toBe(false) // main: true, a deload session this week
      // Another workout started after the move, on the deload's own plan, counts.
      await upload(DELOAD, [6, 6], null, 0, { startedAtMs: await startNow(), explicitNone: true, planPhase: 'deload' })
      expect((await view()).view.trainedThisWeek.has(push)).toBe(true)
      void ws
      // An older payload (no planPhase) that started before the move and finished after counts: main's rule.
      await seed()
      await storePlan(planOf('full', 70, 3, 5), 'auto_applied', t1, "now() + interval '3 days'")
      const started2 = Date.now() - 1000
      await sleep(15)
      await repo.advanceProgramPhase(USER, legs, 'deload')
      await upload(FULL, [5, 5, 4], null, 0, { startedAtMs: started2 })
      expect((await view()).view.trainedThisWeek.has(push)).toBe(true)
    })
  })

  describe('After review: the identity is used', () => {
    it('an explicit "no plan" with a plan stored mid-workout is not "ran a plan"; an old build still reads the stored status', async () => {
      const a = await both(replanAfterExpiry, FULL, [5, 5, 5])
      expect(a.old.after.ranPrescription).toBe(true) // absent: today's reading (the replacement is stored, applied)
      await seed()
      await replanAfterExpiry()
      const ws = await upload(FULL, [5, 5, 5], null, 0, { explicitNone: true })
      const after = await afterFinish(ws)
      expect(after.ranPrescription).toBe(false) // main: true, rep completion read against base-number planned reps
      expect(after.status).toBe('consumed') // the replacement is still spent: it was made without this workout
      expect(after.sessionsInPhase).toBe(3)
    })

    it('a late upload of an older workout does not overwrite the newer one\'s flag', async () => {
      const t1 = T1()
      await storePlan(planOf('full', 70, 3, 5), 'auto_applied', t1, "now() + interval '3 days'")
      await upload(FULL, [5, 5, 5], null, 0, { explicitNone: true }) // the newer workout trained no plan
      expect((await pushRow()).last_session_ran_prescription).toBe(false)
      await upload(FULL, [5, 5, 5], t1, 2 * HOUR, { planPhase: 'accumulation' }) // an older one, synced late
      expect((await pushRow()).last_session_ran_prescription).toBe(false) // main: true
    })

    it('a malformed, ancient or far-future identity, or an unknown phase, is dropped and the finish still lands', async () => {
      for (const planGeneratedAt of ['yesterday', 12, '2001-01-01T00:00:00.000Z', new Date(Date.now() + 3 * HOUR).toISOString()]) {
        const wsId = randomUUID()
        const day = todayInTz(TZ)
        const res = await repo.pushMutations(USER, [
          { id: randomUUID(), domain: 'workout_log' as const, date: day, payload: {
            sessionName: 'Push 4097', sessionId: push, workoutSessionId: wsId, exerciseLogId: randomUUID(), setLogIds: [randomUUID()],
            exercise: LIFT, weights: [70], reps: [5], sets: 1, localDate: day, workoutStartedAt: Date.now() - 600_000, setEndTimes: [Date.now() - 60_000],
            muscleGroups: ['quads'], intensityMode: 'full' } },
          { id: randomUUID(), domain: 'complete_workout', date: day, payload: { workoutSessionId: wsId, completedAtMs: Date.now(), planGeneratedAt, planPhase: 'warp' } },
        ])
        expect(res.errors).toEqual([])
        expect((await pool.query(`SELECT completed_at FROM workout_sessions WHERE id = $1`, [wsId])).rows[0].completed_at).not.toBeNull()
      }
    })
  })

  // ---- #4119: the finish stores the plan phase and every counter reads it, so none undoes another ----
  describe('#4119: one rule for every counter, on the plan phase stored at the finish', () => {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
    const storedPlanPhase = async (wsId: string) =>
      (await pool.query(`SELECT plan_phase FROM workout_sessions WHERE id = $1`, [wsId])).rows[0].plan_phase as string | null
    /** finish -> read -> read -> delete -> read, with the stored counter at each step. The count after the
     *  finish, after each read, and after the delete (the decrement) must agree with what a read says. */
    const sequence = async (wsId: string) => {
      const { deleteWorkoutSession } = await import('@/lib/workout/delete-session')
      const read = async () => { await repo.reconcileSessionsInPhase(USER, program); return (await pushRow()).sessions_in_phase }
      const finish = (await pushRow()).sessions_in_phase
      const read1 = await read()
      const read2 = await read()
      await deleteWorkoutSession(USER, wsId)
      const afterDelete = (await pushRow()).sessions_in_phase
      const read3 = await read()
      return { finish, read1, read2, afterDelete, read3 }
    }
    const move = async (to: 'deload' | 'intensification') => { await sleep(15); await repo.advanceProgramPhase(USER, legs, to) }
    const planned = async () => { const t1 = T1(); await storePlan(planOf('full', 70, 3, 5), 'auto_applied', t1, "now() + interval '3 days'"); return t1 }

    it('(a) trained and finished inside the phase: 2 -> 3 at every step, 2 after the delete', async () => {
      const t1 = await planned()
      const ws = await upload(FULL, [5, 5, 4], t1, 0, { planPhase: 'accumulation' })
      expect(await storedPlanPhase(ws)).toBe('accumulation')
      expect(await sequence(ws)).toEqual({ finish: 3, read1: 3, read2: 3, afterDelete: 2, read3: 2 })
    })

    it('(b) started before a move into a deload, finished after it, new payload: never counted in the deload, and two real deload sessions exit it', async () => {
      const t1 = await planned()
      const started = Date.now() - 1000
      await move('deload')
      const ws = await upload(FULL, [5, 5, 4], t1, 0, { planPhase: 'accumulation', startedAtMs: started })
      expect(await sequence(ws)).toEqual({ finish: 0, read1: 0, read2: 0, afterDelete: 0, read3: 0 })
      // the same workout again (the sequence deleted it): finished, then two real deload sessions
      const again = await upload(FULL, [5, 5, 4], t1, 0, { planPhase: 'accumulation', startedAtMs: started })
      expect((await pushRow()).sessions_in_phase).toBe(0)
      for (let i = 1; i <= DELOAD_FLOOR; i++) {
        await upload(DELOAD, [6, 6], null, 0, { explicitNone: true, planPhase: 'deload' })
        expect((await pushRow()).sessions_in_phase).toBe(i)
      }
      await repo.reconcileSessionsInPhase(USER, program)
      expect((await pushRow()).sessions_in_phase).toBe(DELOAD_FLOOR)
      void again
    })

    it('(c) the same with an OLD payload (no planPhase): counted, exactly as on main', async () => {
      const t1 = await planned()
      const started = Date.now() - 1000
      await move('deload')
      const ws = await upload(FULL, [5, 5, 4], t1, 0, { startedAtMs: started })
      expect(await storedPlanPhase(ws)).toBeNull()
      expect(await sequence(ws)).toEqual({ finish: 1, read1: 1, read2: 1, afterDelete: 0, read3: 0 })
    })

    it('(d) #4119: started AFTER the move on a plan of the old phase: never counted, at any step', async () => {
      const t1 = await planned()
      await move('deload')
      const started = Date.now() - 1
      await sleep(15)
      const ws = await upload(FULL, [5, 5, 4], t1, 0, { planPhase: 'accumulation', startedAtMs: started })
      expect(await sequence(ws)).toEqual({ finish: 0, read1: 0, read2: 0, afterDelete: 0, read3: 0 })
    })

    it('(e) #3799, the web case: no planPhase, started before the move, finished after: counted', async () => {
      const started = Date.now() - 1000
      await move('intensification')
      const ws = await upload(FULL, [5, 5, 4], null, 0, { startedAtMs: started, omitMode: true })
      expect(await sequence(ws)).toEqual({ finish: 1, read1: 1, read2: 1, afterDelete: 0, read3: 0 })
    })

    it('(f) a finish uploaded 2 days late across a move: completed before the move, so never counted, with or without a plan phase', async () => {
      await pool.query(
        `UPDATE session_periodization SET phase = 'intensification', phase_started_at = now() - interval '1 day', sessions_in_phase = 0 WHERE user_id = $1`, [USER])
      for (const planPhase of ['accumulation', undefined]) {
        const ws = await upload(FULL, [5, 5, 4], null, 2 * 24 * HOUR, { ...(planPhase ? { planPhase } : {}), explicitNone: true })
        expect(await sequence(ws)).toEqual({ finish: 0, read1: 0, read2: 0, afterDelete: 0, read3: 0 })
      }
      // and one finished after the move, uploaded a few hours late, on the new phase's plan, counts
      const ws = await upload(FULL, [5, 5, 4], null, 3 * HOUR, { planPhase: 'intensification', explicitNone: true })
      expect(await sequence(ws)).toEqual({ finish: 1, read1: 1, read2: 1, afterDelete: 0, read3: 0 })
    })

    it('(g) a phone clock 2 minutes behind: started_at earlier than the phase start, planPhase the phase: counted', async () => {
      await move('intensification')
      const phaseStart = (await pushRow()) && (await pool.query(`SELECT phase_started_at FROM session_periodization WHERE user_id = $1 AND program_session_id = $2`, [USER, push])).rows[0].phase_started_at as Date
      const ws = await upload(FULL, [5, 5, 4], null, 0, { planPhase: 'intensification', startedAtMs: phaseStart.getTime() - 120_000, explicitNone: true })
      const started = (await pool.query(`SELECT started_at FROM workout_sessions WHERE id = $1`, [ws])).rows[0].started_at as Date
      expect(started.getTime()).toBeLessThan(phaseStart.getTime())
      expect(await sequence(ws)).toEqual({ finish: 1, read1: 1, read2: 1, afterDelete: 0, read3: 0 })
    })

    it('stores the plan phase only from a valid upload, once, and a repeat or an edit never changes it', async () => {
      const t1 = await planned()
      const id = randomUUID()
      await upload(FULL, [5, 5, 4], t1, 0, { planPhase: 'accumulation', workoutSessionId: id })
      expect(await storedPlanPhase(id)).toBe('accumulation')
      // a repeated finish with the same value, a different one, and none: nothing changes
      for (const planPhase of ['accumulation', 'deload', undefined]) {
        await upload(FULL, [5, 5, 4], t1, 0, { ...(planPhase ? { planPhase } : {}), workoutSessionId: id })
        expect(await storedPlanPhase(id)).toBe('accumulation')
      }
      expect((await pushRow()).sessions_in_phase).toBe(3) // and it counted once
      // absent and invalid leave NULL
      const none = await upload(FULL, [5, 5, 4], null, 0, { explicitNone: true })
      expect(await storedPlanPhase(none)).toBeNull()
      const bad = await upload(FULL, [5, 5, 4], null, 0, { planPhase: 'warp', explicitNone: true })
      expect(await storedPlanPhase(bad)).toBeNull()
    })

    it('only the caller\'s own workout row is written (a finish for another user\'s id changes nothing)', async () => {
      const other = '00000000-0000-4000-8000-000000004198'
      await pool.query(`DELETE FROM users WHERE id = $1`, [other])
      await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,'finish-4119-other@example.com','x',$2)`, [other, TZ])
      try {
        const theirs = (await pool.query(`INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1,'Theirs', now() - interval '1 hour') RETURNING id`, [other])).rows[0].id
        expect(await repo.completeWorkoutSession(theirs, USER, new Date(), undefined, 'deload')).toBe(false)
        const row = (await pool.query(`SELECT completed_at, plan_phase FROM workout_sessions WHERE id = $1`, [theirs])).rows[0]
        expect(row).toEqual({ completed_at: null, plan_phase: null })
      } finally {
        await pool.query(`DELETE FROM users WHERE id = $1`, [other])
      }
    })

    it('the finish is not delayed while another connection holds the lift lock for 6 s', async () => {
      const t1 = await planned()
      const holder = await pool.connect()
      try {
        await holder.query('BEGIN')
        await holder.query(`SELECT pg_advisory_xact_lock(hashtext('lift_writes:user'), hashtext($1))`, [USER])
        const day = todayInTz(TZ)
        const wsId = randomUUID()
        const began = Date.now()
        const res = await repo.pushMutations(USER, [
          { id: randomUUID(), domain: 'workout_log' as const, date: day, payload: {
            sessionName: 'Push 4097', sessionId: push, workoutSessionId: wsId, exerciseLogId: randomUUID(), setLogIds: [randomUUID()],
            exercise: LIFT, weights: [70], reps: [5], sets: 1, localDate: day, workoutStartedAt: Date.now() - 600_000, setEndTimes: [Date.now() - 60_000],
            muscleGroups: ['quads'], intensityMode: 'full' } },
          { id: randomUUID(), domain: 'complete_workout', date: day, payload: { workoutSessionId: wsId, completedAtMs: Date.now(), planGeneratedAt: t1.toISOString(), planPhase: 'accumulation' } },
        ])
        const elapsed = Date.now() - began
        process.stderr.write(`[#4119] workout_log + complete_workout with the lift lock held elsewhere: ${elapsed} ms\n`)
        expect(res.errors).toEqual([])
        expect(elapsed).toBeLessThan(3000)
        await sleep(300)
        expect(await storedPlanPhase(wsId)).toBe('accumulation')
        expect((await pushRow()).sessions_in_phase).toBe(3)
      } finally {
        await holder.query('ROLLBACK').catch(() => {})
        holder.release()
      }
    })
  })

  // ---- "Recorded differently from before": a day trained as a deload is a deload day ----
  describe('#4116 review: what a day trained as a deload is recorded as', () => {
    const wsRow = async (id: string) => (await pool.query(`SELECT phase_type, intensity_mode FROM workout_sessions WHERE id = $1`, [id])).rows[0] as { phase_type: string | null; intensity_mode: string | null }
    const e1rms = async (id: string) => (await pool.query(`SELECT exercise_name, estimated_1rm, exercise_deloaded FROM exercise_logs WHERE workout_session_id = $1 ORDER BY exercise_name`, [id])).rows
    const personal = async () => (await repo.getPersonalRecord(USER, LIFT))?.estimated1rm ?? null
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
    const stored = async (id: string) => {
      const sessions = await repo.getWorkoutSessionsFrom(USER, new Date(Date.now() - 2 * 86_400_000))
      return sessions.find(s => s.id === id)!
    }

    it('a one-day deload in a normal phase is recorded phase_type deload: no 1RM, no record, a deload day in weekly stats; a normal session still counts', async () => {
      expect((await pushRow()).phase).toBe('accumulation')
      const deloadWs = await upload(DELOAD, [6, 6], null, 0, { explicitNone: true })
      expect(await wsRow(deloadWs)).toEqual({ phase_type: 'deload', intensity_mode: 'deload' }) // main: phase_type NULL
      expect((await e1rms(deloadWs))[0].estimated_1rm).toBe(0)
      expect(await personal()).toBeNull()
      const day = classifyDay([await stored(deloadWs)])
      expect(day.isDeload).toBe(true) // main: false
      expect(day.volume).toBe(0)      // held out of the headline total
      expect(day.deloadVolume).toBeGreaterThan(0)
      // A normal session the same week still counts.
      const fullWs = await upload(FULL, [5, 5, 4], null, 0, { explicitNone: true })
      expect(await wsRow(fullWs)).toEqual({ phase_type: null, intensity_mode: 'full' })
      const normal = classifyDay([await stored(fullWs)])
      expect(normal).toMatchObject({ isDeload: false, isTesting: false })
      expect(normal.volume).toBeGreaterThan(0)
      const both = classifyDay([await stored(deloadWs), await stored(fullWs)])
      expect(both.volume).toBe(normal.volume)
      expect(both.isDeload).toBe(false)
    })

    it('the NEXT normal session of the lift takes its comparison and 1RM from the last non-deload session, not the deload', async () => {
      const full = await upload(FULL, [5, 5, 4], null, 0, { explicitNone: true })
      expect((await e1rms(full))[0].estimated_1rm).toBe(99)
      await sleep(30)
      const deload = await upload(DELOAD, [6, 6], null, 0, { explicitNone: true })
      expect((await e1rms(deload))[0].estimated_1rm).toBe(0)
      // what the next plan compares against: the full session's 99, not the deload's 0
      expect((await repo.listRecent1rm(USER)).get(LIFT)?.latest).toBe(99)
      expect(await personal()).toBe(99)
      // A rebuilt record reads `phase_type`: it ignores the deload day (`main`: this day had no phase type, so
      // a stray estimate on it, which production has stored before, would have become the record).
      await pool.query(`UPDATE exercise_logs SET estimated_1rm = 150 WHERE workout_session_id = $1`, [deload])
      await repo.reconcilePersonalRecord(USER, LIFT)
      expect(await personal()).toBe(100) // the best non-deload log (the seeded history), not 150
    })

    it('some lifts lightened per exercise, the upload says intensityMode full: recorded full; the lightened lift handled as on main', async () => {
      const t1 = T1()
      await storePlan(planOf('full', 70, 3, 5), 'auto_applied', t1, "now() + interval '3 days'")
      const day = todayInTz(TZ)
      const wsId = randomUUID()
      const mk = (exercise: string, deloaded: boolean) => ({
        id: randomUUID(), domain: 'workout_log' as const, date: day, payload: {
          sessionName: 'Push 4097', sessionId: push, workoutSessionId: wsId, exerciseLogId: randomUUID(), setLogIds: [randomUUID(), randomUUID()],
          exercise, weights: [deloaded ? 50 : 70, deloaded ? 50 : 70], reps: [5, 5], sets: 2, localDate: day, workoutStartedAt: Date.now() - 1_800_000,
          setEndTimes: [Date.now() - 300_000, Date.now() - 200_000], muscleGroups: ['quads'], exerciseDeloaded: deloaded, intensityMode: 'full', wasOverride: false } })
      const res = await repo.pushMutations(USER, [
        mk(LIFT, false), mk(ACC, true),
        { id: randomUUID(), domain: 'complete_workout', date: day, payload: { workoutSessionId: wsId, completedAtMs: Date.now() } },
      ])
      expect(res.errors).toEqual([])
      expect(await wsRow(wsId)).toEqual({ phase_type: null, intensity_mode: 'full' }) // not a deload day
      const rows = await e1rms(wsId)
      const lightened = rows.find(r => r.exercise_name === ACC)!
      const normal = rows.find(r => r.exercise_name === LIFT)!
      expect(lightened).toMatchObject({ exercise_deloaded: true, estimated_1rm: 0 }) // as on main: no estimate, no record
      expect(normal.estimated_1rm).toBeGreaterThan(0)
      expect(classifyDay([await stored(wsId)])).toMatchObject({ isDeload: false })
    })
  })
})
