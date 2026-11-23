// #3900 against a real Postgres, on the production shape: an `ai_dynamic` program on one phase, its
// auto-apply switch OFF (the owner's setting), two session types, accumulation begun six training
// weeks ago at a local Monday midnight. Through `generatePrescriptionForSession` and the serve path
// (`GET /api/workout-data`), with the model mocked (0 real calls):
//   - the window cap's move applies by itself: every row moves to intensification once, the plan is
//     stored `auto_applied` with its loads inside intensification's clamp, and the bar carries them;
//   - the next plan moves nothing more;
//   - a session under way (a set logged today) is never re-planned;
//   - a model deload is the day's plan, and the phase stays;
//   - a plan stored `pending` before this change is brought under the new rule where it is served
//     (review H): a stay or a one-day deload is applied in place, a move is planned again;
//   - a workout under way is judged by its last logged set (second review 1): R1 and R2 on both paths,
//     and a poll never fires a regeneration (R7);
//   - a move another session
//     type makes spares its plan on the AI plan only (review D).
// Runs only with DATABASE_URL. Fake user and lifts; every row it adds is removed in `afterAll`,
// which runs on failure too (the library row by id).
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { programMoveMark } from '@trainingai/shared/ai-periodization/program-phase'
import { intensityZoneForRole } from '@trainingai/shared/ai-periodization/prompt'
import { clampPrescribedPct } from '@trainingai/shared/ai-periodization/autoregulation'
import { resetRegenerationAttempts } from '@trainingai/shared/ai-periodization/pending-plan-adoption'
import { SESSION_UNDER_WAY_LAST_SET_WINDOW_MS } from '@trainingai/shared/ai-periodization/session-under-way'
import type { WorkoutRepository } from '@/lib/data/repository'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'

const model = vi.hoisted(() => ({ answer: null as Record<string, unknown> | null, calls: 0 }))
vi.mock('ai', async orig => ({
  ...(await orig<typeof import('ai')>()),
  generateObject: async () => {
    model.calls++
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
// The serve path's background regeneration is observed, not run: a served plan must not need one.
const regen = vi.hoisted(() => ({ calls: 0 }))
vi.mock('@trainingai/shared/ai-periodization/regenerate-in-background', () => ({
  regeneratePrescriptionInBackground: () => { regen.calls++ },
}))

const canRun = !!process.env.DATABASE_URL
// Not the default timezone: the phase window starts at THIS zone's Monday.
const TZ = 'America/Chicago'
const USER = '00000000-0000-4000-8000-000000003900'
const LIFT = 'Window Squat 3900'
const ACC = 'Window Curl 3900'
const local = (day: string, hour: number) => new Date(dateStrMidnightInTz(day, TZ).getTime() + hour * 3_600_000)

describe.skipIf(!canRun)('the AI plan applies by itself (#3900)', () => {
  let pool: import('pg').Pool
  let repo: WorkoutRepository
  let generate: typeof import('@trainingai/shared/ai-periodization/generate-prescription').generatePrescriptionForSession
  let workoutData: typeof import('@/app/api/workout-data/route').GET
  const libIds: string[] = []
  let push: string, legs: string, pushLift: string, pushAcc: string
  let phaseStart: Date

  const seed = async () => {
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [USER, 'plan-3900@example.com', TZ])
    const program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, auto_apply_prescriptions, created_at)
       VALUES ($1,'Window test','ai_dynamic',true,'strength',false, now() - interval '120 days') RETURNING id`, [USER])).rows[0].id
    const mk = async (name: string, position: number) =>
      (await pool.query(`INSERT INTO program_sessions (program_id, name, position, time_budget_minutes) VALUES ($1,$2,$3,90) RETURNING id`, [program, name, position])).rows[0].id as string
    push = await mk('Push 3900', 0)
    legs = await mk('Legs 3900', 1)
    const ex = async (session: string, name: string, libId: string, position: number, role: string, muscle: string) =>
      (await pool.query(
        `INSERT INTO session_exercises (session_id, exercise_name, exercise_id, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [session, name, libId, position, role, [muscle]])).rows[0].id as string
    pushLift = await ex(push, LIFT, libIds[0], 0, 'primary', 'quads')
    pushAcc = await ex(push, ACC, libIds[1], 1, 'accessory', 'biceps')
    await ex(legs, LIFT, libIds[0], 0, 'primary', 'quads')

    // Six full local weeks of accumulation before this one, each with a completed Legs session.
    const today = todayInTz(TZ)
    const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7
    const thisMonday = shiftDateStr(today, -weekday)
    const startDay = shiftDateStr(thisMonday, -42)
    phaseStart = dateStrMidnightInTz(startDay, TZ)
    for (let w = 0; w < 6; w++) {
      const day = shiftDateStr(startDay, 7 * w + 2)
      const ws = (await pool.query(
        `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Legs 3900',$3,$4) RETURNING id`,
        [USER, legs, local(day, 12), local(day, 13)])).rows[0].id
      const el = (await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, estimated_1rm, logged_at) VALUES ($1,$2,$3,100,$4) RETURNING id`,
        [ws, LIFT, libIds[0], local(day, 12.5)])).rows[0].id
      await pool.query(
        `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, planned_reps, planned_weight_kg, planned_pct, intensity_pct, rest_time_sec, planned_rest_sec, rpe, rpe_source)
         VALUES ($1,1,72,5,5,72,72,72,180,180,7,'rated')`, [el])
    }
    for (const s of [push, legs]) {
      await pool.query(
        `INSERT INTO session_periodization (user_id, program_session_id, phase, phase_started_at, sessions_in_phase, baseline_complete, prescription_status, pending_transition)
         VALUES ($1,$2,'accumulation',$3,$4,true,'consumed',$5::jsonb)`,
        [USER, s, phaseStart, s === legs ? 6 : 0, JSON.stringify(programMoveMark('accumulation'))])
    }
  }

  const rowsOf = async () => (await pool.query(
    `SELECT program_session_id, phase, phase_started_at, prescription, prescription_status FROM session_periodization WHERE user_id = $1`, [USER])).rows as Array<{
      program_session_id: string; phase: string; phase_started_at: Date; prescription: AiPrescription | null; prescription_status: string }>
  const stay = (pct: number) => ({
    phase: 'accumulation', phase_action: 'stay', deload: false, reasoning: 'Steady.',
    exercises: [
      { session_exercise_id: pushLift, name: LIFT, sets: 5, reps: 5, pct, rest_sec: 180 },
      { session_exercise_id: pushAcc, name: ACC, sets: 3, reps: 12, pct: 60, rest_sec: 90 },
    ],
  })
  const serve = async (poll = false) => {
    authUser.current = { id: USER, timezone: TZ }
    const url = `http://localhost/api/workout-data?session=${push}${poll ? '&poll=1' : ''}`
    const res = await workoutData(Object.assign(new Request(url), { nextUrl: new URL(url) }) as never)
    return res.json() as Promise<{ aiPrescriptionPending: boolean; exercises: Array<{ sessionExerciseId: string; progressionStyle: Array<{ pct: number }> | null }> }>
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

  beforeEach(async () => {
    model.calls = 0
    regen.calls = 0
    resetRegenerationAttempts()
    await seed()
  })

  afterAll(async () => {
    await pool?.query(`DELETE FROM users WHERE id = $1`, [USER])
    if (libIds.length > 0) await pool?.query(`DELETE FROM exercise_library WHERE id = ANY($1::uuid[])`, [libIds])
  })

  it('the window cap moves the program once, and the plan applies with intensification loads', async () => {
    model.answer = stay(70)
    const res = await generate(USER, push, repo, TZ)
    expect(res.ok && res.prescriptionStatus).toBe('auto_applied')
    const rows = await rowsOf()
    expect(rows.every(r => r.phase === 'intensification')).toBe(true)
    expect(new Set(rows.map(r => r.phase_started_at.getTime())).size).toBe(1)
    const pushRow = rows.find(r => r.program_session_id === push)!
    expect(pushRow.prescription_status).toBe('auto_applied')
    expect(pushRow.prescription?.phase).toBe('intensification')
    const primary = pushRow.prescription!.exercises.find(e => e.sessionExerciseId === pushLift)!
    const zone = intensityZoneForRole('strength', 'intensification', 'primary')
    expect(primary.pct).toBeGreaterThanOrEqual(clampPrescribedPct(-1, zone))
    expect(primary.pct).toBeLessThanOrEqual(zone.pctMax!)
    expect(primary.pct).toBeGreaterThan(70)
    expect(model.calls).toBe(1)

    // The serve path: the plan drives the bar, nothing is pending, nothing regenerates.
    const served = await serve()
    expect(served.aiPrescriptionPending).toBe(false)
    expect(regen.calls).toBe(0)
    const bar = served.exercises.find(e => e.sessionExerciseId === pushLift)!
    expect(bar.progressionStyle?.every(s => s.pct === primary.pct)).toBe(true)

    // The next plan (a completion's) is made in intensification and moves nothing more.
    model.answer = { ...stay(84), phase: 'intensification' }
    const next = await generate(USER, push, repo, TZ, '00000000-0000-4000-8000-0000000039ff')
    expect(next.ok && next.prescription.phase).toBe('intensification')
    const after = await rowsOf()
    expect(after.every(r => r.phase === 'intensification' && r.phase_started_at.getTime() === rows[0].phase_started_at.getTime())).toBe(true)
  })

  it('a session under way today keeps its plan: no model call, no move, no store', async () => {
    const plan = { phase: 'accumulation', phaseAction: 'stay', reasoning: 'Held.', confidence: 0.9, deload: false, estimatedSessionDurationMin: 40, weeklyVolumeContribution: {},
      exercises: [{ sessionExerciseId: pushLift, name: LIFT, sets: 3, reps: 5, pct: 70, restSec: 180 }] }
    await pool.query(
      `UPDATE session_periodization SET prescription=$3::jsonb, prescription_status='auto_applied', prescription_expires_at=now() + interval '3 days', prescription_generated_at=now() - interval '2 hours'
       WHERE user_id=$1 AND program_session_id=$2`, [USER, push, JSON.stringify(plan)])
    const ws = (await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at) VALUES ($1,$2,'Push 3900', now() - interval '20 minutes') RETURNING id`, [USER, push])).rows[0].id
    await pool.query(`INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, logged_at) VALUES ($1,$2,$3, now() - interval '10 minutes')`, [ws, LIFT, libIds[0]])
    model.answer = stay(70)
    const res = await generate(USER, push, repo, TZ)
    expect(res.ok && res.prescription.reasoning).toBe('Held.')
    expect(model.calls).toBe(0)
    const rows = await rowsOf()
    expect(rows.every(r => r.phase === 'accumulation')).toBe(true)
  })

  it('a deload the model prescribes is the day\'s plan; the phase stays', async () => {
    model.answer = { ...stay(55), phase: 'deload', phase_action: 'deload_recommended', deload: true }
    // One week short of the cap, so no guard moves this plan.
    await pool.query(`UPDATE session_periodization SET phase_started_at = phase_started_at + interval '7 days' WHERE user_id = $1`, [USER])
    const res = await generate(USER, push, repo, TZ)
    expect(res.ok && res.prescription.phaseAction).toBe('deload_recommended')
    expect(res.ok && res.prescriptionStatus).toBe('auto_applied')
    const rows = await rowsOf()
    expect(rows.every(r => r.phase === 'accumulation')).toBe(true)
    expect(rows.find(r => r.program_session_id === push)!.prescription_status).toBe('auto_applied')
  })

  const storePlan = async (session: string, plan: object, status: string, expiresSql = "now() + interval '3 days'", generatedSql = "now() - interval '2 hours'") =>
    pool.query(
      `UPDATE session_periodization SET prescription=$3::jsonb, prescription_status=$4, prescription_expires_at=${expiresSql}, prescription_generated_at=${generatedSql}
       WHERE user_id=$1 AND program_session_id=$2`, [USER, session, JSON.stringify(plan), status])
  const underWay = async (session: string, name: string, startedSql: string) => {
    const ws = (await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at) VALUES ($1,$2,$3, ${startedSql}) RETURNING id`, [USER, session, name])).rows[0].id
    await pool.query(`INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, logged_at) VALUES ($1,$2,$3, now() - interval '5 minutes')`, [ws, LIFT, libIds[0]])
    return ws as string
  }

  // Review H: a plan stored `pending` before this change is brought under the new rule where it is
  // served. Its content is untouched; a stay is promoted in place, with no model call.
  it('a stay stored pending before this change is applied in place where it is served, unchanged', async () => {
    const plan = { phase: 'accumulation', phaseAction: 'stay', reasoning: 'From before.', confidence: 0.9, deload: false, estimatedSessionDurationMin: 40, weeklyVolumeContribution: {},
      exercises: [{ sessionExerciseId: pushLift, name: LIFT, sets: 3, reps: 5, pct: 71, restSec: 180 }] }
    await storePlan(push, plan, 'pending')
    const served = await serve()
    expect(served.aiPrescriptionPending).toBe(false)
    expect(regen.calls).toBe(0)
    expect(model.calls).toBe(0)
    expect(served.exercises.find(e => e.sessionExerciseId === pushLift)!.progressionStyle?.every(s => s.pct === 71)).toBe(true)
    const row = (await rowsOf()).find(r => r.program_session_id === push)!
    expect(row.prescription_status).toBe('auto_applied')
    // The serve path's re-evaluation may stamp `reevaluatedInputsKey` on the cached plan (a background
    // write, as on main); the plan's own content is what must be unchanged.
    const { reevaluatedInputsKey: _stamp, ...content } = row.prescription!
    expect(content).toEqual(plan)
  })

  it('a one-day deload stored pending is applied, until local midnight, and is on the bar', async () => {
    const plan = { phase: 'deload', phaseAction: 'deload_recommended', reasoning: 'Emergency deload: x.', confidence: 1, deload: true, estimatedSessionDurationMin: 30, weeklyVolumeContribution: {},
      exercises: [{ sessionExerciseId: pushLift, name: LIFT, sets: 2, reps: 6, pct: 50, restSec: 120, deloaded: true }] }
    await storePlan(push, plan, 'pending', "now() + interval '6 days'", 'now()')
    const served = await serve()
    expect(served.exercises.find(e => e.sessionExerciseId === pushLift)!.progressionStyle?.every(s => s.pct === 50)).toBe(true)
    const { rows: [r] } = await pool.query(`SELECT prescription_status, prescription_expires_at FROM session_periodization WHERE user_id=$1 AND program_session_id=$2`, [USER, push])
    expect(r.prescription_status).toBe('auto_applied')
    expect(new Date(r.prescription_expires_at).getTime()).toBeLessThanOrEqual(dateStrMidnightInTz(shiftDateStr(todayInTz(TZ), 1), TZ).getTime())
    expect(model.calls).toBe(0)
  })

  it('a move stored pending (its loads the old phase\'s) is planned again; until then it is served as it was', async () => {
    const plan = { phase: 'intensification', phaseAction: 'transition_recommended', reasoning: 'Cap.', confidence: 0.9, deload: false, estimatedSessionDurationMin: 40, weeklyVolumeContribution: {},
      exercises: [{ sessionExerciseId: pushLift, name: LIFT, sets: 3, reps: 5, pct: 72, restSec: 180 }] }
    await storePlan(push, plan, 'pending')
    await serve()
    expect(regen.calls).toBe(1)
    expect((await rowsOf()).find(r => r.program_session_id === push)!.prescription_status).toBe('pending')
  })

  // Review C, second review (1): under way is the age of the last logged set, not the start or the date.
  it('an unfinished workout is under way for 5 hours after its last set, whatever its start or local date', async () => {
    const ws = await underWay(push, 'Push 3900', "now() - interval '30 hours'")
    const since = new Date(Date.now() - SESSION_UNDER_WAY_LAST_SET_WINDOW_MS)
    // Started 30 hours ago, last set 5 minutes ago: under way.
    expect(await repo.listUnfinishedLoggedSessions!(USER, since)).toEqual([push])
    // Last set 4 hours ago: still under way. 6 hours ago: not, though it started inside any start-based window.
    await pool.query(`UPDATE exercise_logs SET logged_at = now() - interval '4 hours' WHERE workout_session_id = $1`, [ws])
    expect(await repo.listUnfinishedLoggedSessions!(USER, since)).toEqual([push])
    await pool.query(`UPDATE workout_sessions SET started_at = now() - interval '7 hours' WHERE id = $1`, [ws])
    await pool.query(`UPDATE exercise_logs SET logged_at = now() - interval '6 hours' WHERE workout_session_id = $1`, [ws])
    expect(await repo.listUnfinishedLoggedSessions!(USER, since)).toEqual([])
    // A set's own end time counts as the last set: one finished 10 minutes ago brings it back.
    const [{ id: el }] = (await pool.query(`SELECT id FROM exercise_logs WHERE workout_session_id = $1`, [ws])).rows
    await pool.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, set_end_ms) VALUES ($1,1,60,5,$2)`, [el, Date.now() - 600_000])
    expect(await repo.listUnfinishedLoggedSessions!(USER, since)).toEqual([push])
    // A finished workout is never under way.
    await pool.query(`UPDATE workout_sessions SET completed_at = now() WHERE id = $1`, [ws])
    expect(await repo.listUnfinishedLoggedSessions!(USER, since)).toEqual([])
  })

  // Second review (1), R1 and R2 through the generation and the serve path (`GET /api/workout-data`).
  const deload = { phase: 'deload', phaseAction: 'deload_recommended', reasoning: 'Emergency deload: x.', confidence: 1, deload: true, estimatedSessionDurationMin: 30, weeklyVolumeContribution: {},
    exercises: [{ sessionExerciseId: '', name: LIFT, sets: 2, reps: 6, pct: 50, restSec: 120, deloaded: true }] }
  const storeDeload = (expiresSql: string) => {
    deload.exercises[0].sessionExerciseId = pushLift
    return storePlan(push, deload, 'auto_applied', expiresSql, "now() - interval '3 hours'")
  }
  const bar = (served: Awaited<ReturnType<typeof serve>>) => served.exercises.find(e => e.sessionExerciseId === pushLift)!.progressionStyle?.map(s => s.pct)

  it('R1: a workout started 40 minutes ago, the applied one-day deload expired 5 minutes ago: generation and serve give the same plan, no regeneration, no model call', async () => {
    await storeDeload("now() - interval '5 minutes'")
    await underWay(push, 'Push 3900', "now() - interval '40 minutes'")
    model.answer = stay(70)
    for (const poll of [false, true]) {
      const served = await serve(poll)
      expect(served.aiPrescriptionPending).toBe(false)
      expect(bar(served)?.every(p => p === 50)).toBe(true)
    }
    const res = await generate(USER, push, repo, TZ)
    expect(res.ok && res.prescription.phaseAction).toBe('deload_recommended')
    expect(res.ok && res.prescriptionStatus).toBe('auto_applied')
    expect(regen.calls).toBe(0)
    expect(model.calls).toBe(0)
    // The plan is the same; the serve path's re-evaluation, restored while under way (third review 3),
    // stamps the day's inputs fingerprint on it exactly as on main.
    const { reevaluatedInputsKey, ...stored } = (await rowsOf()).find(r => r.program_session_id === push)!.prescription as AiPrescription & { reevaluatedInputsKey?: string }
    expect(stored).toEqual(deload)
    expect(reevaluatedInputsKey).toBeDefined()
  })

  it('R2: one set logged 19 hours ago and never finished, yesterday\'s deload expired 8 hours ago: the serve path calls it aged out and generation re-plans it', async () => {
    await storeDeload("now() - interval '8 hours'")
    const ws = await underWay(push, 'Push 3900', "now() - interval '19 hours'")
    await pool.query(`UPDATE exercise_logs SET logged_at = now() - interval '19 hours' WHERE workout_session_id = $1`, [ws])
    expect((await serve()).aiPrescriptionPending).toBe(true)
    expect(regen.calls).toBe(1)
    model.answer = { ...stay(70), phase: 'accumulation' }
    // One week short of the cap, so no guard moves this plan.
    await pool.query(`UPDATE session_periodization SET phase_started_at = phase_started_at + interval '7 days' WHERE user_id = $1`, [USER])
    const res = await generate(USER, push, repo, TZ)
    expect(res.ok && res.prescription.phaseAction).toBe('stay')
    expect(model.calls).toBe(1)
  })

  // Second review (2): R7.
  it('R7: a pending move on an aligned program, six polls: no regeneration; six reads that are not polls: one', async () => {
    const plan = { phase: 'intensification', phaseAction: 'transition_recommended', reasoning: 'Cap.', confidence: 0.9, deload: false, estimatedSessionDurationMin: 40, weeklyVolumeContribution: {},
      exercises: [{ sessionExerciseId: pushLift, name: LIFT, sets: 3, reps: 5, pct: 72, restSec: 180 }] }
    await storePlan(push, plan, 'pending')
    for (let i = 0; i < 6; i++) await serve(true)
    expect(regen.calls).toBe(0)
    for (let i = 0; i < 6; i++) await serve()
    expect(regen.calls).toBe(1)
    expect((await rowsOf()).find(r => r.program_session_id === push)!.prescription_status).toBe('pending')
    expect(model.calls).toBe(0)
  })

  // Review D: a move another session type makes spares the plan of a session under way.
  it('the cap move made by Push leaves Legs\' plan alone while Legs is being trained', async () => {
    const legsPlan = { phase: 'accumulation', phaseAction: 'stay', reasoning: 'Legs today.', confidence: 0.9, deload: false, estimatedSessionDurationMin: 40, weeklyVolumeContribution: {},
      exercises: [{ sessionExerciseId: pushLift, name: LIFT, sets: 4, reps: 6, pct: 72, restSec: 180 }] }
    await storePlan(legs, legsPlan, 'auto_applied')
    await underWay(legs, 'Legs 3900', "now() - interval '20 minutes'")
    model.answer = stay(70)
    const res = await generate(USER, push, repo, TZ)
    expect(res.ok && res.prescriptionStatus).toBe('auto_applied')
    const rows = await rowsOf()
    expect(rows.every(r => r.phase === 'intensification')).toBe(true)
    const legsRow = rows.find(r => r.program_session_id === legs)!
    expect(legsRow.prescription_status).toBe('auto_applied')
    expect(legsRow.prescription).toEqual(legsPlan)
  })

  // ── Third review ──────────────────────────────────────────────────────────────────────────────
  const HOUR = 3_600_000
  /** An unfinished Push workout whose one exercise log reads `loggedSql` on the phone's clock; the
   *  server stamps `updated_at` now. `setEndMs` adds one set carrying that end time. */
  const workoutWith = async (loggedSql: string, setEndMs?: number) => {
    const ws = (await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at) VALUES ($1,$2,'Push 3900', now() - interval '20 hours') RETURNING id`, [USER, push])).rows[0].id
    const el = (await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, logged_at) VALUES ($1,$2,$3, ${loggedSql}) RETURNING id`, [ws, LIFT, libIds[0]])).rows[0].id
    if (setEndMs != null) {
      await pool.query(`INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, set_end_ms) VALUES ($1,1,60,5,$2)`, [el, String(setEndMs)])
    }
    return { ws: ws as string, el: el as string }
  }
  const underWayAt = async (now: Date) =>
    repo.listUnfinishedLoggedSessions!(USER, new Date(now.getTime() - SESSION_UNDER_WAY_LAST_SET_WINDOW_MS))

  it('third review (2): an absurd set_end_ms does not throw, and does not pin the session either way', async () => {
    const now = new Date()
    // 9e18 made `to_timestamp` throw, and "a failed read counts as under way" then pinned it for good.
    const { ws } = await workoutWith(`now() - interval '19 hours'`, 9_000_000_000_000_000_000)
    expect(await underWayAt(now)).toEqual([])
    // Ignored, not distrusted: a believable last-set time on the log still keeps it under way.
    await pool.query(`UPDATE exercise_logs SET logged_at = now() - interval '10 minutes' WHERE workout_session_id = $1`, [ws])
    expect(await underWayAt(now)).toEqual([push])
  })

  it('third review (2): a set_end_ms in seconds reads as 1970: ignored, the log\'s time stands', async () => {
    const now = new Date()
    const { ws } = await workoutWith(`now() - interval '19 hours'`, Math.floor(Date.now() / 1000))
    expect(await underWayAt(now)).toEqual([])
    await pool.query(`UPDATE exercise_logs SET logged_at = now() - interval '1 hour' WHERE workout_session_id = $1`, [ws])
    expect(await underWayAt(now)).toEqual([push])
  })

  it('third review (2): a phone 6 hours ahead, session abandoned: released 5 hours after the server last received a set, not 11', async () => {
    const received = new Date()
    await workoutWith(`now() + interval '6 hours'`, received.getTime() + 6 * HOUR)
    // 4 h 59 min after the server received it: under way. 5 h 01 min: released. (Read as the phone says,
    // it would hold until 11 hours after it was received.)
    expect(await underWayAt(new Date(received.getTime() + 5 * HOUR - 60_000))).toEqual([push])
    expect(await underWayAt(new Date(received.getTime() + 5 * HOUR + 60_000))).toEqual([])
    expect(await underWayAt(new Date(received.getTime() + 8 * HOUR))).toEqual([])
  })

  it('third review (2): a phone only a little ahead (inside 10 minutes) is believed as it says', async () => {
    const received = new Date()
    await workoutWith(`now() + interval '5 minutes'`)
    // Read as the phone says, its last set is 5 minutes after it was received: released 5 h 05 min on.
    expect(await underWayAt(new Date(received.getTime() + 5 * HOUR + 2 * 60_000))).toEqual([push])
    expect(await underWayAt(new Date(received.getTime() + 5 * HOUR + 6 * 60_000))).toEqual([])
  })

  it('third review (2): a workout from yesterday synced late is NOT under way (the receive time is not used for a believable phone time)', async () => {
    await workoutWith(`now() - interval '20 hours'`, Date.now() - 20 * HOUR)
    expect(await underWayAt(new Date())).toEqual([])
  })

  it('third review (2), stated limit: a phone 6 hours BEHIND reads as not under way, the same as a late sync: no server-stamped time tells them apart', async () => {
    await workoutWith(`now() - interval '6 hours'`, Date.now() - 6 * HOUR)
    expect(await underWayAt(new Date())).toEqual([])
  })

  // Third review (1): the session-state readers take "under way" too.
  const sessionState = async () => {
    authUser.current = { id: USER, timezone: TZ }
    const { GET } = await import('@/app/api/ai-periodization/session/[sessionId]/route')
    const res = await GET(new Request(`http://localhost/api/ai-periodization/session/${push}`) as never, { params: Promise.resolve({ sessionId: push }) } as never)
    return (await res.json()) as { state: { prescription: { phaseAction: string } | null; prescriptionAgedOut?: boolean; prescriptionExpiresAt: string | null } }
  }
  const overview = async () => {
    authUser.current = { id: USER, timezone: TZ }
    const { GET } = await import('@/app/api/ai-periodization/program-overview/route')
    const body = (await (await GET()).json()) as { sessions: Array<{ sessionId: string; state: { prescription: unknown | null; prescriptionAgedOut?: boolean; prescriptionExpiresAt: string | null } }> }
    return body.sessions.find(x => x.sessionId === push)!.state
  }

  it('third review (1): a plan that expired mid-workout stays the plan on the card, the overview, the screen\'s own check and /respond', async () => {
    await storeDeload("now() - interval '5 minutes'")
    await underWay(push, 'Push 3900', "now() - interval '40 minutes'")
    const { hidePrescriptionAgedOutOnScreen } = await import('@trainingai/shared/ai-periodization/prescription-expiry')
    const card = await sessionState()
    expect(card.state.prescription?.phaseAction).toBe('deload_recommended')
    expect(card.state.prescriptionAgedOut).toBeUndefined()
    // The screens (web and native) also read the expiry off the wire: the card must survive that too.
    expect(hidePrescriptionAgedOutOnScreen(card.state).prescription).not.toBeNull()
    const listed = await overview()
    expect(listed.prescription).not.toBeNull()
    expect(hidePrescriptionAgedOutOnScreen(listed as Parameters<typeof hidePrescriptionAgedOutOnScreen>[0]).prescription).not.toBeNull()
    // And the bar and the card agree.
    expect((await serve()).aiPrescriptionPending).toBe(false)
    // /respond does not refuse it as aged out.
    const { POST } = await import('@/app/api/ai-periodization/session/[sessionId]/respond/route')
    const res = await POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ action: 'dismiss' }), headers: { 'content-type': 'application/json' } }) as never, { params: Promise.resolve({ sessionId: push }) } as never)
    expect(res.status).not.toBe(409)
    expect(model.calls).toBe(0)
  })

  it('third review (1): the same expired plan with nothing under way is still hidden and flagged (the control)', async () => {
    await storeDeload("now() - interval '5 minutes'")
    const card = await sessionState()
    expect(card.state.prescription).toBeNull()
    expect(card.state.prescriptionAgedOut).toBe(true)
    expect((await overview()).prescriptionAgedOut).toBe(true)
  })

  it('third review (1): the Coach reads a plan under way as driving the bar', async () => {
    await storeDeload("now() - interval '5 minutes'")
    const { readExerciseContext } = await import('@/lib/coach/context')
    const { getDb } = await import('@/lib/data/postgres/client')
    const read = async () => (await readExerciseContext(getDb() as never, repo as never, USER, pushLift, TZ))?.storedPlan?.drivesLoad
    expect(await read()).toBe(false)
    await underWay(push, 'Push 3900', "now() - interval '40 minutes'")
    expect(await read()).toBe(true)
  })

  // Third review (3): what the person enters mid-workout is their own instruction.
  const checkIn = (bodyState: string[], sore: string[]) => pool.query(
    `INSERT INTO mood_logs (user_id, log_date, energy_level, sleep_quality, body_state, sore_muscles, suggested_sore_muscles) VALUES ($1,$2,'ok','ok',$3,$4,ARRAY[]::text[])`,
    [USER, todayInTz(TZ), sore.length > 0 ? [...bodyState, 'sore_muscles'] : bodyState, sore])
  const fullPlan = () => ({ phase: 'accumulation', phaseAction: 'stay', reasoning: 'Held.', confidence: 0.9, deload: false, estimatedSessionDurationMin: 40, weeklyVolumeContribution: {},
    exercises: [
      { sessionExerciseId: pushLift, name: LIFT, sets: 5, reps: 5, pct: 78, restSec: 180 },
      { sessionExerciseId: pushAcc, name: ACC, sets: 3, reps: 12, pct: 60, restSec: 90 },
    ] })
  // The route writes the lightened plan back without waiting for it.
  const cached = async (until?: (p: AiPrescription) => boolean) => {
    for (let i = 0; i < 40; i++) {
      const p = (await rowsOf()).find(r => r.program_session_id === push)!.prescription
      if (!until || (p && until(p))) return p
      await new Promise(r => setTimeout(r, 50))
    }
    return (await rowsOf()).find(r => r.program_session_id === push)!.prescription
  }

  it('third review (3): under way with no new signal, a read changes nothing and fires nothing', async () => {
    await storePlan(push, fullPlan(), 'auto_applied', "now() - interval '5 minutes'")
    await underWay(push, 'Push 3900', "now() - interval '40 minutes'")
    for (const poll of [false, true]) {
      const served = await serve(poll)
      expect(served.aiPrescriptionPending).toBe(false)
      expect(bar(served)?.every(p => p === 78)).toBe(true)
    }
    expect(regen.calls).toBe(0)
    expect(model.calls).toBe(0)
    expect((await cached())!.exercises.map(e => e.pct)).toEqual([78, 60])
  })

  it('third review (3): under way, a sore muscle logged after Start lightens that lift on the next read, as on main', async () => {
    await storePlan(push, fullPlan(), 'auto_applied')
    await underWay(push, 'Push 3900', "now() - interval '40 minutes'")
    await checkIn([], ['Quads'])
    const served = await serve()
    expect(served.aiPrescriptionPending).toBe(false)
    expect(bar(served)?.every(p => p < 78)).toBe(true)
    expect(regen.calls).toBe(0)
    expect(model.calls).toBe(0)
    const row = (await cached(p => p.exercises[0].deloaded === true))!.exercises
    expect(row[0].deloaded).toBe(true)
    expect(row[1].pct).toBe(60)
  })

  it('third review (3): under way, a sick check-in after Start lightens every remaining row; nothing is re-planned', async () => {
    await storePlan(push, fullPlan(), 'auto_applied')
    await underWay(push, 'Push 3900', "now() - interval '40 minutes'")
    await checkIn(['sick'], [])
    const served = await serve()
    expect(served.aiPrescriptionPending).toBe(false)
    expect(bar(served)?.every(p => p < 78)).toBe(true)
    expect((await cached(p => p.exercises.every(e => e.deloaded === true)))!.exercises.every(e => e.deloaded === true)).toBe(true)
    expect(regen.calls).toBe(0)
    expect(model.calls).toBe(0)
  })

  it('third review (3): the same sick check-in with nothing under way asks for a new plan, as on main', async () => {
    await storePlan(push, fullPlan(), 'auto_applied')
    await checkIn(['sick'], [])
    await serve()
    expect(regen.calls).toBe(1)
  })

  it('third review (3): under way, an injury entered after Start changes nothing on its own, as on main', async () => {
    await storePlan(push, fullPlan(), 'auto_applied')
    await underWay(push, 'Push 3900', "now() - interval '40 minutes'")
    await pool.query(`INSERT INTO injuries (user_id, muscle_name, severity, started_date) VALUES ($1,'Quads','mild',$2)`, [USER, todayInTz(TZ)])
    const served = await serve()
    expect(bar(served)?.every(p => p === 78)).toBe(true)
    expect(regen.calls).toBe(0)
  })

  it('on the other program kinds a move voids that plan as before', async () => {
    await pool.query(`UPDATE programs SET phase_mode = 'automatic' WHERE user_id = $1`, [USER])
    await storePlan(legs, { phase: 'accumulation', phaseAction: 'stay', reasoning: 'x', confidence: 0.9, deload: false, estimatedSessionDurationMin: 40, weeklyVolumeContribution: {}, exercises: [] }, 'auto_applied')
    await underWay(legs, 'Legs 3900', "now() - interval '20 minutes'")
    await repo.advanceProgramPhase(USER, push, 'intensification')
    const legsRow = (await rowsOf()).find(r => r.program_session_id === legs)!
    expect(legsRow.prescription_status).toBe('consumed')
    expect(legsRow.prescription).toBeNull()
  })
})
