// #4113 against a real Postgres: a plan generated across a Preview workout's finish. A Preview workout uploads
// only at its finish, so a generation for the same session type may be waiting on the model when the finish
// arrives. It read its signals before the finish, so the plan it makes is made without that workout and must
// not be stored (the slot stays spent and the next open plans it afresh). The model is mocked, gated by the
// test: 0 real requests. Runs only with DATABASE_URL. Made-up names; every row is removed in `afterAll`.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
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
const USER = '00000000-0000-4000-8000-000000004113'
const LIFT = 'Finish Squat 4113'
const ACC = 'Finish Curl 4113'
const HOUR = 3_600_000

describe.skipIf(!canRun)('a finished Preview workout is recorded against the plan it trained (#4113)', () => {
  let pool: import('pg').Pool
  let repo: WorkoutRepository
  let generate: typeof import('@trainingai/shared/ai-periodization/generate-prescription').generatePrescriptionForSession
  const libIds: string[] = []
  let program: string, push: string, legs: string, pushLift: string

  const seed = async () => {
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [USER, 'finish-4113@example.com', TZ])
    program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, auto_apply_prescriptions, created_at)
       VALUES ($1,'Finish test','ai_dynamic',true,'strength',false, now() - interval '120 days') RETURNING id`, [USER])).rows[0].id
    const mk = async (name: string, position: number) =>
      (await pool.query(`INSERT INTO program_sessions (program_id, name, position, time_budget_minutes) VALUES ($1,$2,$3,90) RETURNING id`, [program, name, position])).rows[0].id as string
    push = await mk('Push 4113', 0)
    legs = await mk('Legs 4113', 1)
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
        `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Push 4113',$3,$4) RETURNING id`,
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
      sessionName: 'Push 4113', sessionId: push, workoutSessionId: wsId, exerciseLogId: randomUUID(),
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


  // ---- helpers ----
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
  const FULL = { pct: 70, sets: 3, reps: 5 }
  /** Starts a generation and waits until it is on the model. */
  const generationOnTheModel = async (type = push) => {
    let release!: () => void
    model.hold = new Promise<void>(r => { release = r })
    const callsBefore = model.calls
    const run = generate(USER, type, repo, TZ)
    run.catch(() => undefined)
    for (let i = 0; i < 150 && model.calls === callsBefore; i++) await sleep(20)
    expect(model.calls).toBe(callsBefore + 1)
    return { run, release: () => { release(); model.hold = null } }
  }
  const rowOf = async (session: string) => (await pool.query(
    `SELECT prescription, prescription_status, prescription_generated_at, sessions_in_phase FROM session_periodization WHERE user_id=$1 AND program_session_id=$2`, [USER, session])).rows[0]
  const expired = (t = T1()) => storePlan(planOf('full', 70, 3, 5), 'auto_applied', t, "now() - interval '10 minutes'")

  describe('the finish during a generation (#4113)', () => {
    it('expired plan, generation held on the model, finish uploaded, generation released: the plan is not stored', async () => {
      const t1 = T1()
      await expired(t1)
      model.answer = modelAnswer(80, 4, 3)
      const g = await generationOnTheModel()
      const ws = await upload(FULL, [5, 5, 4], t1)
      g.release()
      const res = await g.run
      expect(res.ok).toBe(false) // refused: the slot's workout moved on
      const after = await afterFinish(ws)
      expect(after.sessionsInPhase).toBe(3)
      expect(after.status).toBe('consumed') // main: 'auto_applied' with a plan made without the workout
      expect((await rowOf(push)).prescription_generated_at?.getTime()).not.toBeGreaterThan(Date.now() - 1) // not rewritten by the generation
      expect(model.calls).toBe(1) // no second model call in the request
    })

    it('the next open plans afresh, as an expired plan does', async () => {
      const t1 = T1()
      await expired(t1)
      model.answer = modelAnswer(80, 4, 3)
      const g = await generationOnTheModel()
      await upload(FULL, [5, 5, 4], t1)
      g.release()
      await g.run
      const next = await generate(USER, push, repo, TZ)
      expect(next.ok).toBe(true)
      expect(model.calls).toBe(2)
      expect((await rowOf(push)).prescription_status).toBe('auto_applied')
    })

    it('the finish first, then the generation starts: nothing changes, it stores', async () => {
      const t1 = T1()
      await expired(t1)
      await upload(FULL, [5, 5, 4], t1)
      model.answer = modelAnswer(80, 4, 3)
      const res = await generate(USER, push, repo, TZ)
      expect(res.ok).toBe(true)
      expect((await rowOf(push)).prescription_status).toBe('auto_applied')
      expect(model.calls).toBe(1)
    })

    it('the generation stores, then the finish: the plan is spent as today', async () => {
      const t1 = T1()
      await expired(t1)
      model.answer = modelAnswer(80, 4, 3)
      expect((await generate(USER, push, repo, TZ)).ok).toBe(true)
      const ws = await upload(FULL, [5, 5, 4], t1)
      const after = await afterFinish(ws)
      expect(after.status).toBe('consumed')
      expect(after.sessionsInPhase).toBe(3)
    })

    it('a finish uploaded late with an old completed_at still counts (the server\'s time, not the phone\'s)', async () => {
      const t1 = T1()
      await expired(t1)
      model.answer = modelAnswer(80, 4, 3)
      const g = await generationOnTheModel()
      // Finished on the phone two days ago, uploaded now: its completed_at is long before the generation began.
      await upload(FULL, [5, 5, 4], t1, 2 * 24 * HOUR)
      g.release()
      const res = await g.run
      expect(res.ok).toBe(false)
      expect((await rowOf(push)).prescription_status).toBe('consumed')
    })

    it('a finish of ANOTHER session type does not stop this one\'s plan', async () => {
      const t1 = T1()
      await expired(t1)
      model.answer = modelAnswer(80, 4, 3)
      const g = await generationOnTheModel()
      const [row] = (await pool.query(`INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Legs 4113', now() - interval '1 hour', now()) RETURNING id`, [USER, legs])).rows
      expect(row.id).toBeTruthy()
      g.release()
      expect((await g.run).ok).toBe(true)
      expect((await rowOf(push)).prescription_status).toBe('auto_applied')
    })

    it('two session types generating at once, one finishing: only that one is refused', async () => {
      const t1 = T1()
      await expired(t1)
      await pool.query(`UPDATE session_periodization SET prescription_status='consumed', prescription=NULL WHERE user_id=$1 AND program_session_id=$2`, [USER, legs])
      model.answer = { ...modelAnswer(80, 4, 3) }
      let release!: () => void
      model.hold = new Promise<void>(r => { release = r })
      const a = generate(USER, push, repo, TZ)
      const b = generate(USER, legs, repo, TZ)
      for (let i = 0; i < 150 && model.calls < 2; i++) await sleep(20)
      expect(model.calls).toBe(2)
      await upload(FULL, [5, 5, 4], t1) // Push finishes
      release()
      const [ra, rb] = await Promise.all([a, b])
      expect(ra.ok).toBe(false)
      expect(rb.ok).toBe(true)
      expect((await rowOf(push)).prescription_status).toBe('consumed')
      expect((await rowOf(legs)).prescription_status).not.toBe('consumed')
    })

    it('a web workout (it logs as it goes) is under way: the generation holds, as before this change', async () => {
      const t1 = T1()
      await expired(t1)
      const ws = (await pool.query(
        `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at) VALUES ($1,$2,'Push 4113', now() - interval '10 minutes') RETURNING id`, [USER, push])).rows[0].id
      const el = (await pool.query(`INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, estimated_1rm, logged_at) VALUES ($1,$2,$3,100,now()) RETURNING id`, [ws, LIFT, libIds[0]])).rows[0].id
      await pool.query(`INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, planned_reps, planned_weight_kg, planned_pct, rest_time_sec, planned_rest_sec) VALUES ($1,1,70,5,5,70,70,180,180)`, [el])
      model.answer = modelAnswer(80, 4, 3)
      const res = await generate(USER, push, repo, TZ)
      const row = await rowOf(push)
      // Held by `holdPrescriptionUnderWay`: no model call, and nothing of this change is involved.
      expect(model.calls).toBe(0)
      expect(res.ok === true || res.ok === false).toBe(true)
      expect(row.prescription_status).toBe('auto_applied')
    })

    it('the finish is not delayed by the lift lock held from another connection for 6 s', async () => {
      const t1 = T1()
      await expired(t1)
      const holder = await pool.connect()
      try {
        await holder.query('BEGIN')
        await holder.query(`SELECT pg_advisory_xact_lock(hashtext('lift_writes:user'), hashtext($1))`, [USER])
        const t0 = Date.now()
        await upload(FULL, [5, 5, 4], t1)
        const took = Date.now() - t0
        const line = `[4113] finish upload with the lift lock held 6 s from another connection: ${took - 400} ms (the harness's 400 ms wait taken off)`
        console.info(line)
        if (process.env.MEASURE_OUT) appendFileSync(process.env.MEASURE_OUT, line + '\n')
        expect(took).toBeLessThan(2500)
      } finally {
        await holder.query('ROLLBACK')
        holder.release()
      }
    })
  })
})
