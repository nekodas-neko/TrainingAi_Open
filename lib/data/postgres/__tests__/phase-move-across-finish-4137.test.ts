// #4137 (2): an auto-applied phase move is guarded by the same finish marker as the store (#4113). The window cap
// moves the program when the model answers `stay` at the cap; the move runs after the model call. A workout of the
// session's type finished while the model was answering means the move was decided from signals read before it:
// the phase does not move, and the plan is refused as before. With no finish the move is as it was (byte for byte:
// the same rows as the move made without the marker). The model is mocked and gated by the test: 0 real requests.
// Runs only with DATABASE_URL. Made-up names; every row is removed in `afterAll`.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { programMoveMark } from '@trainingai/shared/ai-periodization/program-phase'
import { resetRegenerationAttempts } from '@trainingai/shared/ai-periodization/pending-plan-adoption'
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
const regen = vi.hoisted(() => ({ calls: 0 }))
vi.mock('@trainingai/shared/ai-periodization/regenerate-in-background', () => ({
  regeneratePrescriptionInBackground: () => { regen.calls++ },
}))

const canRun = !!process.env.DATABASE_URL
const TZ = 'America/Chicago'
const USER = '00000000-0000-4000-8000-000000004137'
const LIFT = 'Move Squat 4137'
const ACC = 'Move Curl 4137'
const local = (day: string, hour: number) => new Date(dateStrMidnightInTz(day, TZ).getTime() + hour * 3_600_000)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe.skipIf(!canRun)('an auto-applied phase move made across a workout\'s finish (#4137)', () => {
  let pool: import('pg').Pool
  let repo: WorkoutRepository
  let generate: typeof import('@trainingai/shared/ai-periodization/generate-prescription').generatePrescriptionForSession
  const libIds: string[] = []
  let push: string, legs: string, pushLift: string, pushAcc: string
  let phaseStart: Date

  const seed = async () => {
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [USER, 'move-4137@example.com', TZ])
    const program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, auto_apply_prescriptions, created_at)
       VALUES ($1,'Window test','ai_dynamic',true,'strength',false, now() - interval '120 days') RETURNING id`, [USER])).rows[0].id
    const mk = async (name: string, position: number) =>
      (await pool.query(`INSERT INTO program_sessions (program_id, name, position, time_budget_minutes) VALUES ($1,$2,$3,90) RETURNING id`, [program, name, position])).rows[0].id as string
    push = await mk('Push 4137', 0)
    legs = await mk('Legs 4137', 1)
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
        `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Legs 4137',$3,$4) RETURNING id`,
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
  beforeEach(async () => {
    model.calls = 0; model.hold = null; model.answer = null; regen.calls = 0
    resetRegenerationAttempts()
    await seed()
  })
  afterAll(async () => {
    await pool?.query(`DELETE FROM users WHERE id = $1`, [USER])
    if (libIds.length > 0) await pool?.query(`DELETE FROM exercise_library WHERE id = ANY($1::uuid[])`, [libIds])
  })

  /** The generation, waiting on the model; `release()` lets it answer. */
  const onTheModel = async () => {
    model.answer = stay(70)
    let release!: () => void
    model.hold = new Promise<void>(r => { release = r })
    const run = generate(USER, push, repo, TZ)
    for (let i = 0; i < 150 && model.calls === 0; i++) await sleep(20)
    expect(model.calls).toBe(1)
    return { release: () => release(), run }
  }
  const finishPush = () => pool.query(
    `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Push 4137', now() - interval '1 hour', now())`, [USER, push])
  const phases = async () => (await rowsOf()).map(r => `${r.program_session_id === push ? 'push' : 'legs'}:${r.phase}:${r.prescription_status}`).sort()

  it('no finish during the call: the cap move is made, as it always was', async () => {
    const g = await onTheModel()
    g.release()
    const res = await g.run
    expect(res.ok && res.prescriptionStatus).toBe('auto_applied')
    expect(await phases()).toEqual(['legs:intensification:consumed', 'push:intensification:auto_applied'])
  })

  it('a workout finished while the model was answering: the phase does not move and the plan is not stored', async () => {
    const before = (await rowsOf()).map(r => r.phase_started_at.getTime()).sort()
    const g = await onTheModel()
    await finishPush()
    g.release()
    const res = await g.run
    expect(res.ok).toBe(false)
    // main: the program moved to intensification anyway, with the plan refused.
    expect(await phases()).toEqual(['legs:accumulation:consumed', 'push:accumulation:consumed'])
    expect((await rowsOf()).map(r => r.phase_started_at.getTime()).sort()).toEqual(before)
    expect(model.calls).toBe(1)
  })

  it('a finish of the OTHER session type does not stop the move', async () => {
    const g = await onTheModel()
    await pool.query(`INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Legs 4137', now() - interval '1 hour', now())`, [USER, legs])
    g.release()
    const res = await g.run
    expect(res.ok && res.prescriptionStatus).toBe('auto_applied')
    expect((await rowsOf()).every(r => r.phase === 'intensification')).toBe(true)
  })

  it('the move on its own (the repository call): no marker is as before; a marker with a later finish moves nothing and voids nothing', async () => {
    const state = (await repo.getSessionPeriodization(USER, push))!
    const stamp = await repo.getActiveProgramWithStructureStamp(USER, push)
    const planned = { phase: state.phase, phaseStartedAt: state.phaseStartedAt }
    // A stored plan on Legs, which a move would void.
    await pool.query(`UPDATE session_periodization SET prescription=$3::jsonb, prescription_status='auto_applied' WHERE user_id=$1 AND program_session_id=$2`, [USER, legs, JSON.stringify({ phase: 'accumulation', phaseAction: 'stay', reasoning: 'Legs.', confidence: 0.9, deload: false, estimatedSessionDurationMin: 40, weeklyVolumeContribution: {}, exercises: [] })])
    await finishPush()
    // A finish BEFORE the marker was read is not a finish after it: the marker covers it.
    const covered = await repo.getActiveProgramWithStructureStamp(USER, push)
    expect(covered.finishMarker).not.toBeNull()
    await repo.advanceProgramPhase(USER, push, 'intensification', { ...planned, finishMarker: covered.finishMarker })
    expect((await rowsOf()).every(r => r.phase === 'intensification')).toBe(true)
    // Back to accumulation for the refusal case.
    await seed()
    await pool.query(`UPDATE session_periodization SET prescription=$3::jsonb, prescription_status='auto_applied' WHERE user_id=$1 AND program_session_id=$2`, [USER, legs, JSON.stringify({ phase: 'accumulation', phaseAction: 'stay', reasoning: 'Legs.', confidence: 0.9, deload: false, estimatedSessionDurationMin: 40, weeklyVolumeContribution: {}, exercises: [] })])
    const marker = (await repo.getActiveProgramWithStructureStamp(USER, push)).finishMarker
    await finishPush()
    const row = await repo.advanceProgramPhase(USER, push, 'intensification', { ...planned, finishMarker: marker })
    expect(row.phase).toBe('accumulation')
    expect(await phases()).toEqual(['legs:accumulation:auto_applied', 'push:accumulation:consumed'])
    // Without a marker the same call moves it, as before (#4137 changes nothing for a caller that passes none).
    await repo.advanceProgramPhase(USER, push, 'intensification', planned)
    expect((await rowsOf()).every(r => r.phase === 'intensification')).toBe(true)
    expect(stamp.program).toBeTruthy()
  })
})
