/**
 * #4098 review: a READ never waits for a writer, row locks included.
 *
 * The review measured `GET /api/workout-data` at 15,017 ms (the pool's statement timeout) with the person's lift
 * lock AND a `FOR UPDATE` on their plan rows held from another connection (a weekly check-in save holds both) and a
 * pending plan present: `adoptPendingPrescription` is a plain row UPDATE with no `lock_timeout`. Every write a read
 * can reach now runs in a transaction whose `lock_timeout` is `readLockWait` (300 ms) and is skipped on a miss.
 *
 * For each such write: hold the lift lock and `FOR UPDATE` on the user's plan rows (or, for the check-in insert, an
 * uncommitted insert of the same row) from another connection; the read returns in well under a second with what is
 * stored, nothing is written; after the release the next read performs the write.
 *
 * Real Postgres only (DATABASE_URL), model mocked (0 requests). A made-up user per run (random id, so another run of
 * this file on the same database cannot collide); everything is removed in `afterAll`.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { dateStrMidnightInTz, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { programMoveMark } from '@trainingai/shared/ai-periodization/program-phase'
import { resetRegenerationAttempts } from '@trainingai/shared/ai-periodization/pending-plan-adoption'
import type { WorkoutRepository } from '@/lib/data/repository'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'

vi.mock('ai', async orig => ({
  ...(await orig<typeof import('ai')>()),
  generateObject: async () => { throw new Error('no model in this test') },
}))
vi.mock('@/lib/observability', () => ({ reportServerError: vi.fn() }))
const authUser = vi.hoisted(() => ({ current: null as null | { id: string; timezone: string } }))
vi.mock('@/auth', () => ({ auth: async () => (authUser.current ? { user: authUser.current } : null) }))
const regen = vi.hoisted(() => ({ calls: 0 }))
vi.mock('@trainingai/shared/ai-periodization/regenerate-in-background', () => ({
  regeneratePrescriptionInBackground: () => { regen.calls++ },
}))

const canRun = !!process.env.DATABASE_URL
const TZ = 'America/Chicago'
const RUN = randomUUID()
const USER = RUN
const TAG = RUN.slice(0, 8)
const LIFT = `Bound Squat ${TAG}`
const ACC = `Bound Curl ${TAG}`
/** A read that waits for a lock answers in about 300 ms plus its own work; 1.5 s is far under the 4 s write wait and
 *  the 15 s statement timeout the review measured, and loose enough for a busy shared database. */
const FAST_MS = 1500
const local = (day: string, hour: number) => new Date(dateStrMidnightInTz(day, TZ).getTime() + hour * 3_600_000)

describe.skipIf(!canRun)('writes a read reaches wait at most readLockWait (#4098 review)', () => {
  let pool: import('pg').Pool
  let repo: WorkoutRepository
  let workoutData: typeof import('@/app/api/workout-data/route').GET
  let sessionState: typeof import('@/app/api/ai-periodization/session/[sessionId]/route').GET
  let nextSession: typeof import('@/app/api/next-session/route').GET
  let overview: typeof import('@/app/api/ai-periodization/program-overview/route').GET
  const libIds: string[] = []
  let program: string, push: string, legs: string, pushLift: string

  const plan = (status: string, over: Record<string, unknown> = {}) => ({
    phase: 'accumulation', phaseAction: 'stay', reasoning: 'From before.', confidence: 0.9, deload: false,
    estimatedSessionDurationMin: 40, weeklyVolumeContribution: {},
    exercises: [{ sessionExerciseId: pushLift, name: LIFT, sets: 3, reps: 5, pct: 71, restSec: 180 }],
    ...over,
  }) as unknown as AiPrescription & { status?: string }
  const oneDayDeload = () => ({
    phase: 'deload', phaseAction: 'deload_recommended', reasoning: 'Emergency deload: x.', confidence: 1, deload: true,
    estimatedSessionDurationMin: 30, weeklyVolumeContribution: {},
    exercises: [{ sessionExerciseId: pushLift, name: LIFT, sets: 2, reps: 6, pct: 50, restSec: 120, deloaded: true }],
  })
  const storePlan = (session: string, p: object, status: string, generatedSql = "now() - interval '2 hours'") =>
    pool.query(
      `UPDATE session_periodization SET prescription=$3::jsonb, prescription_status=$4, prescription_expires_at=now() + interval '3 days',
         prescription_generated_at=${generatedSql} WHERE user_id=$1 AND program_session_id=$2`, [USER, session, JSON.stringify(p), status])
  const row = async (session = push) =>
    (await pool.query(`SELECT * FROM session_periodization WHERE user_id = $1 AND program_session_id = $2`, [USER, session])).rows[0]

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    ;({ GET: workoutData } = await import('@/app/api/workout-data/route'))
    ;({ GET: sessionState } = await import('@/app/api/ai-periodization/session/[sessionId]/route'))
    ;({ GET: nextSession } = await import('@/app/api/next-session/route'))
    ;({ GET: overview } = await import('@/app/api/ai-periodization/program-overview/route'))
    for (const [name, muscle, equipment] of [[LIFT, 'quads', 'barbell'], [ACC, 'biceps', 'cable']]) {
      libIds.push((await pool.query(
        `INSERT INTO exercise_library (name, equipment, muscles) VALUES ($1, ARRAY[$3], $2::jsonb) RETURNING id`,
        [name, JSON.stringify([{ muscle, role: 'main' }]), equipment])).rows[0].id)
    }
  })
  afterAll(async () => {
    if (!pool) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    if (libIds.length > 0) await pool.query(`DELETE FROM exercise_library WHERE id = ANY($1::uuid[])`, [libIds])
  })

  beforeEach(async () => {
    regen.calls = 0
    resetRegenerationAttempts()
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [USER, `bound-${TAG}@example.com`, TZ])
    program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, auto_apply_prescriptions, created_at)
       VALUES ($1,'Bound test','ai_dynamic',true,'strength',false, now() - interval '120 days') RETURNING id`, [USER])).rows[0].id
    const mk = async (name: string, position: number) =>
      (await pool.query(`INSERT INTO program_sessions (program_id, name, position, time_budget_minutes) VALUES ($1,$2,$3,90) RETURNING id`, [program, name, position])).rows[0].id as string
    push = await mk('Push', 0)
    legs = await mk('Legs', 1)
    const ex = async (session: string, name: string, libId: string, position: number, role: string, muscle: string) =>
      (await pool.query(
        `INSERT INTO session_exercises (session_id, exercise_name, exercise_id, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [session, name, libId, position, role, [muscle]])).rows[0].id as string
    pushLift = await ex(push, LIFT, libIds[0], 0, 'primary', 'quads')
    await ex(push, ACC, libIds[1], 1, 'accessory', 'biceps')
    await ex(legs, LIFT, libIds[0], 0, 'primary', 'quads')
    // Accumulation begun 6 weeks ago, aligned and marked, a completed Legs session in each week (as #3900's seed).
    const today = todayInTz(TZ)
    const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7
    const startDay = shiftDateStr(shiftDateStr(today, -weekday), -42)
    const phaseStart = dateStrMidnightInTz(startDay, TZ)
    for (let w = 0; w < 6; w++) {
      const day = shiftDateStr(startDay, 7 * w + 2)
      const ws = (await pool.query(
        `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Legs',$3,$4) RETURNING id`,
        [USER, legs, local(day, 12), local(day, 13)])).rows[0].id
      const el = (await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, estimated_1rm, logged_at) VALUES ($1,$2,$3,100,$4) RETURNING id`,
        [ws, LIFT, libIds[0], local(day, 12.5)])).rows[0].id
      await pool.query(
        `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, planned_reps, planned_weight_kg, planned_pct, intensity_pct, rest_time_sec, planned_rest_sec, rpe, rpe_source)
         VALUES ($1,1,72,5,5,72,72,72,180,180,7,'rated')`, [el])
    }
    for (const sess of [push, legs]) {
      await pool.query(
        `INSERT INTO session_periodization (user_id, program_session_id, phase, phase_started_at, sessions_in_phase, baseline_complete, prescription_status, pending_transition)
         VALUES ($1,$2,'accumulation',$3,$4,true,'consumed',$5::jsonb)`,
        [USER, sess, phaseStart, sess === legs ? 6 : 0, JSON.stringify(programMoveMark('accumulation'))])
    }
  })

  /**
   * Another connection holding the person's lift lock and `FOR UPDATE` on all their plan rows, as a weekly
   * check-in save does. `holdMs` keeps it held at least that long (the 6 s of the review); it is released when `fn`
   * returns, or after `holdMs`, whichever is later.
   */
  const holding = async <T>(fn: () => Promise<T>, holdMs = 0): Promise<T> => {
    const other = await pool.connect()
    const started = Date.now()
    try {
      await other.query('BEGIN')
      await other.query(`SELECT pg_advisory_xact_lock(hashtext('lift_writes:user'), hashtext($1))`, [USER])
      await other.query(`SELECT id FROM session_periodization WHERE user_id = $1 FOR UPDATE`, [USER])
      const out = await fn()
      const rest = holdMs - (Date.now() - started)
      if (rest > 0) await new Promise(r => setTimeout(r, rest))
      return out
    } finally {
      await other.query('ROLLBACK').catch(() => undefined)
      other.release()
    }
  }
  const timed = async <T>(fn: () => Promise<T>): Promise<{ out: T; ms: number }> => {
    const t0 = Date.now()
    const out = await fn()
    return { out, ms: Date.now() - t0 }
  }
  const asUser = () => { authUser.current = { id: USER, timezone: TZ } }
  const serve = async () => {
    asUser()
    const url = `http://localhost/api/workout-data?session=${push}`
    const res = await workoutData(Object.assign(new Request(url), { nextUrl: new URL(url) }) as never)
    return res.json() as Promise<{ aiPrescriptionPending: boolean; exercises: Array<{ sessionExerciseId: string; progressionStyle: Array<{ pct: number }> | null }> }>
  }
  const bar = (served: Awaited<ReturnType<typeof serve>>) => served.exercises.find(e => e.sessionExerciseId === pushLift)!.progressionStyle?.map(x => x.pct)
  const sessionRead = async () => {
    asUser()
    const res = await sessionState(new Request('http://localhost/x') as never, { params: Promise.resolve({ sessionId: push }) })
    return res.json() as Promise<{ prescriptionStatus?: string; state?: { prescriptionStatus?: string } } & Record<string, unknown>>
  }

  // ── The adoption: the one the review measured ────────────────────────────────────────────────────

  it('workout-data: with the lift lock and FOR UPDATE on the plan rows held for 6 s, the read returns the plan as stored in well under a second; the next read adopts it', async () => {
    // A one-day deload stored pending: adoption applies it, and only an applied one is on the bar.
    await storePlan(push, oneDayDeload(), 'pending', 'now()')
    const held = await holding(async () => timed(serve), 6000)
    expect(held.ms, 'the read did not wait for the row lock').toBeLessThan(FAST_MS)
    expect((await row()).prescription_status, 'nothing written while held').toBe('pending')
    // A pending deload does not drive the bar; an applied one does. While held the response is what it was before
    // the adoption ran (the plan not on the bar), never the adopted state the database does not have.
    expect(bar(held.out), 'answered with the plan as stored, still pending: not on the bar').not.toEqual([50, 50])
    const next = await serve()
    expect((await row()).prescription_status, 'adopted by the next read').toBe('auto_applied')
    expect(bar(next), 'adopted: on the bar').toEqual([50, 50])
  }, 20_000)

  it('the session-state read: the same, and the response still says pending', async () => {
    await storePlan(push, plan('pending'), 'pending')
    const held = await holding(async () => timed(sessionRead), 6000)
    expect(held.ms).toBeLessThan(FAST_MS)
    expect((await row()).prescription_status).toBe('pending')
    expect(JSON.stringify(held.out)).toContain('"prescriptionStatus":"pending"')
    await sessionRead()
    expect((await row()).prescription_status).toBe('auto_applied')
  }, 20_000)

  it('next-session and the program overview return at once with everything held, a plan pending', async () => {
    await storePlan(push, plan('pending'), 'pending')
    await pool.query(`UPDATE session_periodization SET sessions_in_phase = 3 WHERE user_id = $1 AND program_session_id = $2`, [USER, legs])
    asUser()
    const held = await holding(async () => ({ next: await timed(() => nextSession()), overview: await timed(() => overview()) }))
    expect(held.next.ms).toBeLessThan(FAST_MS)
    expect(held.overview.ms).toBeLessThan(FAST_MS)
    expect(held.next.out.status).toBe(200)
    expect(held.overview.out.status).toBe(200)
    expect((await row()).prescription_status).toBe('pending')
    expect((await row(legs)).sessions_in_phase, 'the drift is repaired by a later read, not while held').toBe(3)
    await overview()
    expect((await row(legs)).sessions_in_phase, 'repaired by the next read').toBe(6)
  })

  // ── Each write, on its own ──────────────────────────────────────────────────────────────────────

  it('adoptPendingPrescription: skipped, false; then written', async () => {
    const p = plan('pending')
    await storePlan(push, p, 'pending')
    const generatedAt = (await row()).prescription_generated_at as Date
    const expires = new Date(Date.now() + 86_400_000)
    const held = await holding(() => timed(() => repo.adoptPendingPrescription!(USER, push, generatedAt, 'auto_applied', expires)))
    expect(held.ms).toBeLessThan(FAST_MS)
    expect(held.out).toBe(false)
    expect((await row()).prescription_status).toBe('pending')
    expect(await repo.adoptPendingPrescription!(USER, push, generatedAt, 'auto_applied', expires)).toBe(true)
    expect((await row()).prescription_status).toBe('auto_applied')
  })

  it('voidSessionPrescription in read mode (the program overview\'s waiting branch): skipped; written on the next call; a write still waits', async () => {
    await storePlan(push, plan('pending'), 'pending')
    const held = await holding(() => timed(() => repo.voidSessionPrescription(USER, push, { read: true })))
    expect(held.ms).toBeLessThan(FAST_MS)
    expect((await row()).prescription_status).toBe('pending')
    await repo.voidSessionPrescription(USER, push, { read: true })
    expect((await row()).prescription_status).toBe('consumed')
    expect((await row()).prescription).toBeNull()
  })

  it('revertAutoAdoptedBaseline (the session-state read): skipped, answers null; then reverts', async () => {
    await pool.query(
      `UPDATE session_periodization SET baseline_complete = true, baseline_1rm = $3::jsonb WHERE user_id = $1 AND program_session_id = $2`,
      [USER, push, JSON.stringify({ [pushLift]: { kg: 100, source: 'personal_record' } })])
    const held = await holding(() => timed(() => repo.revertAutoAdoptedBaseline(USER, push)))
    expect(held.ms).toBeLessThan(FAST_MS)
    expect(held.out).toBeNull()
    expect((await row()).baseline_complete).toBe(true)
    expect((await repo.revertAutoAdoptedBaseline(USER, push))?.baselineComplete).toBe(false)
  })

  it('storePrescription in read mode (the check-in fit) and replacePrescriptionIfUnchanged (the check-in hold): skipped, false; then written', async () => {
    const before = plan('pending')
    await storePlan(push, before, 'auto_applied')
    const after = plan('pending', { reasoning: 'Held.' })
    const held = await holding(async () => ({
      store: await timed(() => repo.storePrescription(USER, push, after, new Date(Date.now() + 86_400_000), 'auto_applied', undefined, { read: true })),
      replace: await timed(() => repo.replacePrescriptionIfUnchanged!(USER, push, before, after)),
    }))
    expect(held.store.ms).toBeLessThan(FAST_MS)
    expect(held.replace.ms).toBeLessThan(FAST_MS)
    expect(held.store.out).toBe(false)
    expect(held.replace.out).toBe(false)
    expect((await row()).prescription.reasoning).toBe('From before.')
    expect(await repo.replacePrescriptionIfUnchanged!(USER, push, before, after)).toBe(true)
    expect((await row()).prescription.reasoning).toBe('Held.')
  })

  it('updatePrescriptionExercisesCache (the read\'s cached plan): skipped; then written', async () => {
    await storePlan(push, plan('pending'), 'auto_applied')
    const next = plan('pending', { reasoning: 'Cached.' })
    const held = await holding(() => timed(() => repo.updatePrescriptionExercisesCache(USER, push, next)))
    expect(held.ms).toBeLessThan(FAST_MS)
    expect((await row()).prescription.reasoning).toBe('From before.')
    await repo.updatePrescriptionExercisesCache(USER, push, next)
    expect((await row()).prescription.reasoning).toBe('Cached.')
  })

  it('reconcileSessionsInPhase: with only a plan row held (no lift lock) it skips quietly, then repairs the count', async () => {
    await pool.query(`UPDATE session_periodization SET sessions_in_phase = 3 WHERE user_id = $1 AND program_session_id = $2`, [USER, legs])
    const other = await pool.connect()
    try {
      await other.query('BEGIN')
      await other.query(`SELECT id FROM session_periodization WHERE user_id = $1 FOR UPDATE`, [USER])
      const { ms } = await timed(() => repo.reconcileSessionsInPhase(USER, program))
      expect(ms).toBeLessThan(FAST_MS)
    } finally {
      await other.query('ROLLBACK').catch(() => undefined)
      other.release()
    }
    expect((await row(legs)).sessions_in_phase).toBe(3)
    await repo.reconcileSessionsInPhase(USER, program)
    expect((await row(legs)).sessions_in_phase).toBe(6)
  })

  it('the restate of a spent one-shot on a preferences read: skipped, the plan still carries the stamp; the next read takes it off', async () => {
    const setAt = new Date(Date.now() - 30 * 86_400_000)
    const stamped = plan('pending', {
      exercises: [{ sessionExerciseId: pushLift, name: LIFT, sets: 3, reps: 5, pct: 71, restSec: 180, liftPreference: { loadStep: 'lighter', oneShotSetAt: setAt.toISOString() } }],
    })
    await storePlan(push, stamped, 'auto_applied')
    await pool.query(
      `INSERT INTO exercise_preferences (user_id, exercise_name, exercise_id, next_load_step, one_shot_set_at, source) VALUES ($1,$2,$3,'lighter',$4,'coach')`,
      [USER, LIFT, libIds[0], setAt])
    const held = await holding(() => timed(() => repo.listExercisePreferences!(USER, [LIFT])))
    expect(held.ms).toBeLessThan(FAST_MS)
    const stillStamped = JSON.stringify((await row()).prescription)
    expect(stillStamped).toContain('oneShotSetAt')
    // The preference row was cleared by that first read (SKIP LOCKED never waits); the stamp is found again by the
    // next read's stale select and taken off.
    await repo.listExercisePreferences!(USER, [LIFT])
    expect(JSON.stringify((await row()).prescription)).not.toContain('oneShotSetAt')
  })

  it('ensureSessionPeriodization: a READ answers within readLockWait while the same row\'s insert is uncommitted; a WRITE waits for it and gets the row', async () => {
    const period = await import('@/lib/data/postgres/slices/periodization')
    const { getDb } = await import('@/lib/data/postgres/client')
    const db = getDb()
    // A third session with no state row yet, and another connection half way through creating it (a program save).
    const arms = (await pool.query(`INSERT INTO program_sessions (program_id, name, position, time_budget_minutes) VALUES ($1,'Arms',2,60) RETURNING id`, [program])).rows[0].id as string
    const other = await pool.connect()
    try {
      await other.query('BEGIN')
      await other.query(`INSERT INTO session_periodization (user_id, program_session_id, phase) VALUES ($1,$2,'accumulation')`, [USER, arms])
      // The read does not wait for the commit, and has no row to answer with yet.
      const read = await timed(() => period.ensureSessionPeriodization(db, USER, arms, { read: true }))
      expect(read.ms).toBeLessThan(FAST_MS)
      expect(read.out ?? null).toBeNull()
      // The write waits. It is still waiting well after the read wait has passed, and gets the row at the commit.
      let settled = false
      const write = period.ensureSessionPeriodization(db, USER, arms).then(out => { settled = true; return out })
      await new Promise(r => setTimeout(r, 900))
      expect(settled, 'a write is not cut short at the read wait').toBe(false)
      await other.query('COMMIT')
      const state = await write
      expect(state).not.toBeNull()
      expect(state.phase).toBe('accumulation')
    } finally {
      await other.query('ROLLBACK').catch(() => undefined)
      other.release()
    }
    // With nothing racing, both create or return the row at once.
    expect((await period.ensureSessionPeriodization(db, USER, arms, { read: true })).phase).toBe('accumulation')
  })

  it('the weekly check-in state read: the row insert waits at most readLockWait for an uncommitted insert of the same row, writes nothing, and the next read creates it', async () => {
    const { readCheckinState } = await import('@/lib/weekly-checkin/engine')
    const { getDb } = await import('@/lib/data/postgres/client')
    // Sunday 18:00 local of this week: the card is due with no row.
    const today = todayInTz(TZ)
    const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7
    const monday = shiftDateStr(today, -weekday)
    const now = local(shiftDateStr(monday, 6), 18)
    const ctx = { db: getDb(), repo, userId: USER, tz: TZ, now }
    const other = await pool.connect()
    let held: { out: Awaited<ReturnType<typeof readCheckinState>>; ms: number }
    try {
      await other.query('BEGIN')
      await other.query(`INSERT INTO weekly_checkins (user_id, week_start, applies_week_start) VALUES ($1,$2,$3)`, [USER, monday, shiftDateStr(monday, 7)])
      held = await timed(() => readCheckinState(ctx))
    } finally {
      await other.query('ROLLBACK').catch(() => undefined)
      other.release()
    }
    expect(held.ms).toBeLessThan(FAST_MS)
    expect(held.out.checkin, 'answered from what is stored: no row yet').toBeNull()
    expect((await pool.query(`SELECT 1 FROM weekly_checkins WHERE user_id = $1`, [USER])).rowCount).toBe(0)
    const next = await readCheckinState(ctx)
    expect(next.checkin).not.toBeNull()
    expect((await pool.query(`SELECT 1 FROM weekly_checkins WHERE user_id = $1`, [USER])).rowCount).toBe(1)
  })
})
