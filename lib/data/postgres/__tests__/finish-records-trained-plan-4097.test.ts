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
import { programMoveMark } from '@trainingai/shared/ai-periodization/program-phase'
import { resetRegenerationAttempts } from '@trainingai/shared/ai-periodization/pending-plan-adoption'
import { repCompletionFromSetLogs } from '@trainingai/shared/ai-periodization/rep-completion'
import type { WorkoutRepository } from '@/lib/data/repository'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'

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
  const upload = async (trained: { pct: number; sets: number; reps: number; deload?: boolean }, reps: number[], identity: Date | null | undefined, agoMs = 0) => {
    const wsId = randomUUID()
    // `agoMs`: the workout was finished offline this long ago and is uploaded now.
    const now = Date.now() - agoMs
    const localDay = shiftDateStr(todayInTz(TZ), 0) === todayInTz(TZ) && agoMs === 0 ? todayInTz(TZ) : new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(now))
    const n = trained.sets
    const kg = Math.round(trained.pct) // 100 kg basis
    const logPayload = {
      sessionName: 'Push 4097', sessionId: push, workoutSessionId: wsId, exerciseLogId: randomUUID(),
      setLogIds: Array.from({ length: n }, () => randomUUID()), exercise: LIFT,
      weights: Array(n).fill(kg), reps, sets: n, localDate: localDay, workoutStartedAt: now - 40 * 60_000,
      setEndTimes: Array.from({ length: n }, (_, i) => now - (n - i) * 120_000),
      progressionStyle: Array.from({ length: n }, () => ({ pct: trained.pct, reps: trained.reps, restSec: 180 })),
      plannedWeights: Array(n).fill(kg), prescriptionBasisKg: 100,
      muscleGroups: ['quads'], exerciseDeloaded: trained.deload === true,
      intensityMode: trained.deload ? 'deload' : 'full', wasOverride: false,
    }
    const complete = {
      workoutSessionId: wsId, completedAtMs: now,
      ...(identity ? { planGeneratedAt: identity.toISOString() } : {}),
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

    it('B, another type moves the phase and voids the plan: counted once in the new phase; the voided plan leaves "ran a plan" false (the gap)', async () => {
      const { old } = await both(() => phaseMovedByAnotherType(false), FULL, [5, 5, 4])
      expect(old.mid.prescription).toBeNull()
      expect(old.mid.prescription_status).toBe('consumed')
      expect(old.after.phase).toBe('intensification')
      expect(old.after.sessionsInPhase).toBe(1) // completed after the move, so it counts in the phase it finished in (#3799)
      expect(old.after.repRate).toBeCloseTo(14 / 15, 6)
      expect(old.after.ranPrescription).toBe(false) // the stored plan is gone, so the finish reads "no plan was run"
      expect(old.modelCallsAtFinish).toBe(0) // nothing was made mid-workout: nothing wasted
    })

    it('B, voided and then planned again before the finish: the replacement (new phase) is the one spent', async () => {
      const { old } = await both(() => phaseMovedByAnotherType(true), FULL, [5, 5, 4])
      expect(old.mid.prescription!.phase).toBe('intensification')
      expect(old.after.status).toBe('consumed')
      expect(old.after.sessionsInPhase).toBe(1)
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
      // Not fixed here: the generation stores after the finish, with signals read before it, so a plan made
      // without the finished workout is left applied. It is the stored plan at the finish that is spent, and
      // this one was not stored yet. Pinned as it is today; the fix is #4113.
      expect(after.status).toBe('auto_applied')
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
})
