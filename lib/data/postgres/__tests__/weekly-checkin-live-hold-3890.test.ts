// #3890 (decision 8): "Heavy" holds the lift in the live plan, against a real Postgres.
//   - A check-in saved through the engine with Heavy on the press, for this week (`applies_week_start`).
//   - Generating this week's plan: the model (mocked) asks for more than the press's last bar; the plan
//     stored is capped at that bar, the squat is not, and sets and reps are the model's.
//   - A plan stored BEFORE the save: the save and the undo leave `session_periodization` byte for byte;
//     a read in the week serves it capped; after Undo the same read serves it at its own load again.
//   - A person with no check-in: the stored-plan read is one query, as on main, and returns the plan as stored.
// The model is a mock (0 real calls). Runs only with DATABASE_URL. Fake users and lifts.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr, todayInTz, weekStartForDay } from '@trainingai/shared/date-utils'
import { prescribedBar } from '@trainingai/shared/workout/load-rounding'
import type { WorkoutRepository } from '@/lib/data/repository'
import type { AiPrescription, SessionPeriodization } from '@trainingai/shared/types/ai-periodization'

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

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const A = '00000000-0000-4000-8000-00000389f0a1'
const NONE = '00000000-0000-4000-8000-00000389f0b2'
const SQ = 'Hold Squat 3890'
const BP = 'Hold Press 3890'

// This week is the applies-to week; the check-in reviews last week.
const MON = weekStartForDay(todayInTz(TZ))
const W0 = shiftDateStr(MON, -7)
const local = (day: string, hour: number) => new Date(dateStrMidnightInTz(day, TZ).getTime() + hour * 3_600_000)
const SAVE_AT = local(shiftDateStr(W0, 6), 18) // last Sunday, 18:00
const LAST_BAR = 70

describe.skipIf(!canRun)('the weekly check-in\'s Heavy hold in the live plan (#3890)', () => {
  let pool: import('pg').Pool
  let repo: WorkoutRepository
  let engine: typeof import('@/lib/weekly-checkin/engine')
  let serve: typeof import('@trainingai/shared/ai-periodization/checkin-plan-budget').fitStoredPlanToCheckinBudget
  let generate: typeof import('@trainingai/shared/ai-periodization/generate-prescription').generatePrescriptionForSession
  let ctxFor: (user: string, now?: Date) => import('@/lib/weekly-checkin/engine').EngineCtx
  const ids: Record<string, string> = {}

  const seed = async (user: string) => {
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [user, `hold-3890-${user}@example.com`, TZ])
    const program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, created_at) VALUES ($1,'Hold test','ai_dynamic',true,'strength', now() - interval '90 days') RETURNING id`, [user])).rows[0].id
    const session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position, time_budget_minutes) VALUES ($1,'Hold Day',0,90) RETURNING id`, [program])).rows[0].id
    const schedule = (await pool.query(`INSERT INTO schedules (program_id, type) VALUES ($1,'weekly') RETURNING id`, [program])).rows[0].id
    for (const day of [0, 2, 4]) await pool.query(`INSERT INTO schedule_days (schedule_id, day_of_week, session_id) VALUES ($1,$2,$3)`, [schedule, day, session])
    const ex = async (name: string, pos: number) =>
      (await pool.query(`INSERT INTO session_exercises (session_id, exercise_name, exercise_id, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,$4,'primary',$5) RETURNING id`,
        [session, name, ids[`lib:${name}`], pos, [pos === 0 ? 'quads' : 'chest']])).rows[0].id as string
    const sq = await ex(SQ, 0)
    const bp = await ex(BP, 1)
    for (const d of [0, 2, 4]) {
      const day = shiftDateStr(W0, d)
      const ws = (await pool.query(
        `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Hold Day',$3,$4) RETURNING id`,
        [user, session, local(day, 12), local(day, 13)])).rows[0].id
      for (const name of [SQ, BP]) {
        const el = (await pool.query(
          `INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, estimated_1rm, logged_at) VALUES ($1,$2,$3,100,$4) RETURNING id`,
          [ws, name, ids[`lib:${name}`], local(day, 12.5)])).rows[0].id
        for (let n = 1; n <= 3; n++) {
          await pool.query(
            `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, planned_reps, planned_weight_kg, planned_pct, rest_time_sec, planned_rest_sec)
             VALUES ($1,$2,$3,5,5,$3,80,180,180)`, [el, n, LAST_BAR])
        }
      }
    }
    await pool.query(
      `INSERT INTO session_periodization (user_id, program_session_id, phase, sessions_in_phase, baseline_complete, prescription_status)
       VALUES ($1,$2,'accumulation',2,true,'none')`, [user, session])
    return { session, sq, bp }
  }

  /** The model's answer: both lifts heavier than their last bar (90 % of a 100 kg basis = 90 kg). */
  const answerFor = (user: string) => ({
    phase: 'accumulation', phase_action: 'stay', deload: false, reasoning: 'Push on.',
    exercises: [
      { session_exercise_id: ids[`${user}:sq`], name: SQ, sets: 4, reps: 5, pct: 85, rest_sec: 180 },
      { session_exercise_id: ids[`${user}:bp`], name: BP, sets: 4, reps: 5, pct: 85, rest_sec: 180 },
    ],
  })
  const storedPlan = (user: string): AiPrescription => ({
    phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: 'Stored before the save.', source: 'model',
    estimatedSessionDurationMin: 50, weeklyVolumeContribution: {}, confidence: 0.7, confidenceReasons: [],
    durationPreset: 'standard', sessionTimeBudgetMinutes: 90,
    exercises: [
      { sessionExerciseId: ids[`${user}:sq`], name: SQ, sets: 4, reps: 5, pct: 85, restSec: 180 },
      { sessionExerciseId: ids[`${user}:bp`], name: BP, sets: 4, reps: 5, pct: 85, restSec: 180 },
    ],
    refitBaseline: { sets: { [ids[`${user}:sq`]]: 4, [ids[`${user}:bp`]]: 4 }, reasoning: 'Stored before the save.' },
  } as AiPrescription)
  const store = (user: string, p: AiPrescription) => pool.query(
    `UPDATE session_periodization SET prescription = $3::jsonb, prescription_status = 'pending',
       prescription_generated_at = $4, prescription_expires_at = $5 WHERE user_id = $1 AND program_session_id = $2`,
    [user, ids[`${user}:session`], JSON.stringify(p), new Date(Date.now() - 86_400_000), new Date(Date.now() + 6 * 86_400_000)])
  const rawRow = async (user = A) => (await pool.query(
    `SELECT prescription::text AS raw, prescription_status, prescription_expires_at, updated_at
       FROM session_periodization WHERE user_id = $1 AND program_session_id = $2`, [user, ids[`${user}:session`]])).rows[0]
  const read = async (user = A, now = new Date()) =>
    serve(user, ids[`${user}:session`], repo, TZ, await repo.getSessionPeriodization(user, ids[`${user}:session`]) as SessionPeriodization, now)
  const bar = (p: AiPrescription | null, id: string) => prescribedBar(100, p!.exercises.find(e => e.sessionExerciseId === id)!.pct, ['barbell'])
  const saveHeavy = () => engine.saveCheckin(ctxFor(A, SAVE_AT), {
    weekStart: W0,
    lifts: [{ sessionExerciseId: ids['A:sq'], answer: 'about_right' }, { sessionExerciseId: ids['A:bp'], answer: 'heavy' }],
    pain: false, swap: null, daysOff: null, shorterSessionMin: null,
  })

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    engine = await import('@/lib/weekly-checkin/engine')
    ;({ fitStoredPlanToCheckinBudget: serve } = await import('@trainingai/shared/ai-periodization/checkin-plan-budget'))
    ;({ generatePrescriptionForSession: generate } = await import('@trainingai/shared/ai-periodization/generate-prescription'))
    ctxFor = (user, now = new Date()) => ({ db: client.getDb(), repo, userId: user, tz: TZ, now })
    // A killed earlier run may have left these rows behind; every key referencing them is ON DELETE SET NULL.
    await removeLibraryRows()
    // Muscle and equipment names the real library already uses and the home-gym coverage scan
    // (home-gym-exercise-gaps-migration) counts as home-reachable: lower-case "barbell", and "quads" not
    // "quadriceps" (#4039). So these rows cannot strand a muscle group in that scan while this file runs.
    for (const [name, muscle] of [[SQ, 'quads'], [BP, 'chest']]) {
      ids[`lib:${name}`] = (await pool.query(
        `INSERT INTO exercise_library (name, equipment, muscles) VALUES ($1, ARRAY['barbell'], $2::jsonb)
         ON CONFLICT (name) DO UPDATE SET equipment = EXCLUDED.equipment, muscles = EXCLUDED.muscles RETURNING id`,
        [name, JSON.stringify([{ muscle, role: 'main' }])])).rows[0].id
    }
  })

  const removeLibraryRows = () => pool.query(`DELETE FROM exercise_library WHERE name = ANY($1)`, [[SQ, BP]])

  beforeEach(async () => {
    model.calls = 0
    model.answer = null
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[A, NONE]])
    for (const [key, user] of [['A', A], ['NONE', NONE]] as const) {
      const s = await seed(user)
      ids[`${key}:session`] = s.session; ids[`${key}:sq`] = s.sq; ids[`${key}:bp`] = s.bp
      ids[`${user}:session`] = s.session; ids[`${user}:sq`] = s.sq; ids[`${user}:bp`] = s.bp
    }
  })

  afterAll(async () => {
    // Users first: their session exercises, logs and check-ins go with them; the rest of the keys to a
    // library row are ON DELETE SET NULL.
    await pool?.query(`DELETE FROM users WHERE id = ANY($1)`, [[A, NONE]])
    await pool?.query(`DELETE FROM exercise_library WHERE name = ANY($1)`, [[SQ, BP]])
  })

  it('generation in the applies-to week caps the held press at its last bar and leaves the squat alone', async () => {
    const { state } = await saveHeavy()
    expect(state.checkin!.lifts.find(l => l.exerciseName === BP)).toMatchObject({ effect: 'held', holdLive: true })
    model.answer = answerFor(A)
    const res = await generate(A, ids['A:session'], repo, TZ)
    expect(res.ok).toBe(true)
    const p = (res as { prescription: AiPrescription }).prescription
    expect(bar(p, ids['A:bp'])).toBeLessThanOrEqual(LAST_BAR)
    expect(bar(p, ids['A:sq'])).toBeGreaterThan(LAST_BAR)
    const press = p.exercises.find(e => e.sessionExerciseId === ids['A:bp'])!
    const squat = p.exercises.find(e => e.sessionExerciseId === ids['A:sq'])!
    expect([press.sets, press.reps]).toEqual([squat.sets, squat.reps])
    expect(p.checkinHold?.weekStart).toBe(MON)
    expect(Object.keys(p.checkinHold!.rows)).toEqual([ids['A:bp']])
    expect(model.calls).toBe(1)
    // The person with no check-in, same answer: nothing is capped and nothing is recorded.
    model.answer = answerFor(NONE)
    const plain = (await generate(NONE, ids['NONE:session'], repo, TZ)) as { prescription: AiPrescription }
    expect(bar(plain.prescription, ids['NONE:bp'])).toBeGreaterThan(LAST_BAR)
    expect(plain.prescription.checkinHold).toBeUndefined()
  })

  it('a plan stored before the save: the save and the undo write nothing to it; a read in the week holds it, after undo it is its own again', async () => {
    await store(A, storedPlan(A))
    const before = await rawRow()
    const { state } = await saveHeavy()
    expect(await rawRow()).toEqual(before)

    const held = await read()
    expect(bar(held.prescription, ids['A:bp'])).toBeLessThanOrEqual(LAST_BAR)
    expect(held.prescription!.exercises.find(e => e.sessionExerciseId === ids['A:sq'])!.pct).toBe(85)
    expect(JSON.parse((await rawRow()).raw)).toEqual(held.prescription)
    // A second read writes nothing.
    const stamped = await rawRow()
    await read()
    expect(await rawRow()).toEqual(stamped)

    const liftId = state.checkin!.lifts.find(l => l.exerciseName === BP)!.liftId
    await engine.undoCheckinEffect(ctxFor(A, SAVE_AT), state.checkin!.id, { kind: 'lift', liftId })
    expect(await rawRow()).toEqual(stamped) // the undo touched no stored plan either
    const own = await read()
    expect(own.prescription).toEqual(storedPlan(A))
    expect(model.calls).toBe(0)
  })

  it('no check-in: the stored-plan read is one query and serves the plan as stored', async () => {
    await store(NONE, storedPlan(NONE))
    const spy = vi.spyOn(pool, 'query')
    const served = await read(NONE)
    const n = spy.mock.calls.length
    spy.mockRestore()
    expect(n).toBe(1)
    expect(served.prescription).toEqual(storedPlan(NONE))
  })

  it('five reads at once in the held week all serve the press at its last bar, and exactly one stores it', async () => {
    await store(A, storedPlan(A))
    await saveHeavy()
    const swap = vi.spyOn(repo, 'replacePrescriptionIfUnchanged')
    const served = await Promise.all(Array.from({ length: 5 }, () => read()))
    const won = (await Promise.all(swap.mock.results.map(r => r.value as Promise<boolean>))).filter(Boolean).length
    swap.mockRestore()
    for (const s of served) expect(bar(s.prescription, ids['A:bp'])).toBe(LAST_BAR)
    expect(won).toBe(1)
    expect(bar(JSON.parse((await rawRow()).raw), ids['A:bp'])).toBe(LAST_BAR)
  })

  it('the check-in view says the press is capped only when the hold can cap it', async () => {
    const { state } = await saveHeavy()
    const press = () => state.checkin!.lifts.find(l => l.exerciseName === BP)!
    expect(press()).toMatchObject({ effect: 'held', holdLive: true, capped: true })
    expect(state.checkin!.lifts.find(l => l.exerciseName === SQ)).toMatchObject({ holdLive: null, capped: null })
    // Its last log a deload (estimate stored as 0): no last bar, so nothing is capped and the card says so.
    await pool.query(
      `UPDATE exercise_logs SET estimated_1rm = 0 WHERE exercise_id = $1
          AND workout_session_id IN (SELECT id FROM workout_sessions WHERE user_id = $2)
          AND logged_at = (SELECT max(logged_at) FROM exercise_logs l JOIN workout_sessions w ON w.id = l.workout_session_id
                            WHERE w.user_id = $2 AND l.exercise_id = $1)`, [ids[`lib:${BP}`], A])
    const after = await engine.readCheckinState(ctxFor(A, SAVE_AT))
    expect(after.checkin!.lifts.find(l => l.exerciseName === BP)).toMatchObject({ effect: 'held', holdLive: false, capped: false })
  })
})
