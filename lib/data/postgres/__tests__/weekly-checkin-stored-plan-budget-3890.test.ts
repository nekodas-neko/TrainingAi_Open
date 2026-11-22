// #3890: a shorter session from the weekly check-in reaches a STORED plan where it is served, never at
// save or undo (the Orchestrator's ruling, 22 Nov). A pending plan stored on Friday, a check-in saved on
// Sunday for 30 minutes:
//   (a) a read on Sunday (the plan's own week) returns the plan byte for byte and leaves the row alone;
//   (b) a read on the applies-to week's Monday fits it to 30 minutes with the preset re-fit, 0 model calls;
//   (c) after Undo, a read gives the session its own length back;
//   (d) a length the person picks wins over the check-in, and stays theirs;
//   (e) a read in the week after the applies-to week is not shortened.
// And a person with no check-in: the stored-plan read is the same one query as on main.
//
// The re-fit runs for real (signals, budget stage, guarded store) against the local database. The
// model is mocked to throw, and counted. Runs only with DATABASE_URL. Fake user and lifts.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr, todayInTz, weekStartForDay } from '@trainingai/shared/date-utils'
import type { WorkoutRepository } from '@/lib/data/repository'
import type { AiPrescription, SessionPeriodization } from '@trainingai/shared/types/ai-periodization'

const modelCalls = vi.fn()
vi.mock('@/lib/ai/instrument', async orig => ({
  ...(await orig<typeof import('@/lib/ai/instrument')>()),
  loggedGenerateObject: vi.fn(async () => { modelCalls(); throw new Error('no model call in this test') }),
}))

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-0000003890f1'
const NONE = '00000000-0000-4000-8000-0000003890f2' // no check-in at all
const TZ = 'Australia/Brisbane'
const LIFTS = ['S3890 Squat', 'S3890 Row', 'S3890 Curl', 'S3890 Raise']

// The applies-to week is this week, so the stored-plan read's window (around the database's today)
// holds it. Friday and Sunday are the week before.
const MON = weekStartForDay(todayInTz(TZ))
const at = (day: string, hour = 12) => new Date(dateStrMidnightInTz(day, TZ).getTime() + hour * 3_600_000)
const FRI = shiftDateStr(MON, -3)
const SUN = shiftDateStr(MON, -1)

describe.skipIf(!canRun)('a shorter session reaches a stored plan where it is served (#3890)', () => {
  let pool: import('pg').Pool
  let repo: WorkoutRepository
  let fit: typeof import('@trainingai/shared/ai-periodization/checkin-plan-budget').fitStoredPlanToCheckinBudget
  let refit: typeof import('@trainingai/shared/ai-periodization/refit-prescription').refitPrescriptionToBudget
  const sessions: Record<string, string> = {}
  const exIds: Record<string, string[]> = {}

  const plan = (user: string): AiPrescription => ({
    phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: 'Keep going.', source: 'model',
    estimatedSessionDurationMin: 58, weeklyVolumeContribution: {}, confidence: 0.7, confidenceReasons: [],
    durationPreset: 'standard', sessionTimeBudgetMinutes: 60,
    exercises: exIds[user].map((id, i) => ({ sessionExerciseId: id, name: LIFTS[i], sets: 4, reps: 8, pct: 72, restSec: 150 })),
    refitBaseline: { sets: Object.fromEntries(exIds[user].map(id => [id, 4])), reasoning: 'Keep going.' },
  } as AiPrescription)

  const row = async (user = USER) => (await pool.query(
    `SELECT prescription, prescription::text AS raw, prescription_status, prescription_expires_at, updated_at
       FROM session_periodization WHERE user_id = $1 AND program_session_id = $2`, [user, sessions[user]])).rows[0]
  const read = async (now: Date, user = USER) => {
    const state = await repo.getSessionPeriodization(user, sessions[user]) as SessionPeriodization
    return fit(user, sessions[user], repo, TZ, state, now)
  }
  const totalSets = (p: AiPrescription | null) => (p?.exercises ?? []).reduce((n, e) => n + e.sets, 0)
  const saveCheckin = (min: number | null) => pool.query(
    `INSERT INTO weekly_checkins (user_id, week_start, applies_week_start, status, saved_at, shorter_session_min)
     VALUES ($1, $2, $3, 'saved', $4, $5)
     ON CONFLICT (user_id, applies_week_start) DO UPDATE SET shorter_session_min = EXCLUDED.shorter_session_min`,
    [USER, shiftDateStr(MON, -7), MON, at(SUN), min])

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    ;({ fitStoredPlanToCheckinBudget: fit } = await import('@trainingai/shared/ai-periodization/checkin-plan-budget'))
    ;({ refitPrescriptionToBudget: refit } = await import('@trainingai/shared/ai-periodization/refit-prescription'))
  })

  beforeEach(async () => {
    modelCalls.mockClear()
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, NONE]])
    for (const user of [USER, NONE]) {
      await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [user, `s3890-${user}@example.com`, TZ])
      const program = (await pool.query(
        `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal) VALUES ($1,'S3890','ai_dynamic',true,'hypertrophy') RETURNING id`, [user])).rows[0].id
      sessions[user] = (await pool.query(
        `INSERT INTO program_sessions (program_id, name, position, time_budget_minutes) VALUES ($1,'S3890 Day',0,60) RETURNING id`, [program])).rows[0].id
      exIds[user] = []
      for (const [i, name] of LIFTS.entries()) {
        exIds[user].push((await pool.query(
          `INSERT INTO session_exercises (session_id, exercise_name, position, muscle_groups, exercise_role)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [sessions[user], name, i, [['quads'], ['back'], ['biceps'], ['shoulders']][i], i === 0 ? 'primary' : i === 1 ? 'secondary' : 'accessory'])).rows[0].id)
      }
      // Stored on Friday, served for 7 days: into the applies-to week.
      await pool.query(
        `INSERT INTO session_periodization (user_id, program_session_id, phase, sessions_in_phase, baseline_complete, prescription,
           prescription_status, prescription_generated_at, prescription_expires_at)
         VALUES ($1,$2,'accumulation',1,true,$3::jsonb,'pending',$4,$5)`,
        [user, sessions[user], JSON.stringify(plan(user)), at(FRI), new Date(at(FRI).getTime() + 7 * 86_400_000)])
      // What generation would have stored: the baseline fitted to the session's own 60 minutes.
      expect((await refit(user, sessions[user], repo, TZ, 'standard', at(FRI))).ok).toBe(true)
    }
    await saveCheckin(30)
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, NONE]])
  })

  it('(a) a read on Sunday, before the applies-to week, returns the stored plan byte for byte and writes nothing', async () => {
    const before = await row()
    const served = await read(at(SUN, 18))
    expect(JSON.stringify(served.prescription)).toBe(JSON.stringify(before.prescription))
    expect(await row()).toEqual(before)
  })

  it('(b) a read on the applies-to Monday is fitted to 30 minutes by the preset re-fit, with no model call', async () => {
    const served = await read(at(MON, 7))
    expect(served.prescription).toMatchObject({ durationPreset: 30, checkinBudgetMin: 30 })
    expect(totalSets(served.prescription)).toBeLessThan(16)
    expect(served.prescription!.estimatedSessionDurationMin).toBeLessThan(58)
    // Stored, so every screen that reads it after sees the same plan; a second read re-fits nothing.
    const stored = await row()
    expect(stored.prescription).toEqual(served.prescription)
    expect(stored.prescription_status).toBe('pending')
    const again = await read(at(MON, 9))
    expect(await row()).toEqual(stored)
    expect(again.prescription).toEqual(served.prescription)
    expect(modelCalls).not.toHaveBeenCalled()
  })

  it('(c) after Undo, a read serves the session at its own length again', async () => {
    const original = (await row()).prescription
    await read(at(MON, 7))
    await saveCheckin(null) // what Undo leaves: the column NULL, no stored plan touched
    const served = await read(at(shiftDateStr(MON, 1)))
    expect(served.prescription!.checkinBudgetMin).toBeUndefined()
    expect(served.prescription!.durationPreset).toBe('standard')
    expect(served.prescription!.exercises.map(e => [e.sessionExerciseId, e.sets, e.restSec]))
      .toEqual(original.exercises.map((e: { sessionExerciseId: string; sets: number; restSec: number }) => [e.sessionExerciseId, e.sets, e.restSec]))
    expect(modelCalls).not.toHaveBeenCalled()
  })

  it('(d) a length the person picks wins, and the check-in does not take it back', async () => {
    await read(at(MON, 7))
    // The pre-workout control's re-fit (the prescribe route's call), after the check-in's.
    const picked = await refit(USER, sessions[USER], repo, TZ, 45, at(MON, 8))
    expect(picked.ok).toBe(true)
    const served = await read(at(MON, 9))
    expect(served.prescription).toMatchObject({ durationPreset: 45, checkinBudgetMin: null })
    // Even a pick of the session's own length.
    await refit(USER, sessions[USER], repo, TZ, 'standard', at(MON, 10))
    expect((await read(at(MON, 11))).prescription).toMatchObject({ durationPreset: 'standard', checkinBudgetMin: null })
    // A pick made before the week starts is the person's too.
    await pool.query(`UPDATE session_periodization SET prescription = $3::jsonb WHERE user_id = $1 AND program_session_id = $2`,
      [USER, sessions[USER], JSON.stringify({ ...plan(USER), durationPreset: 45 })])
    expect((await read(at(MON, 12))).prescription).toMatchObject({ durationPreset: 45 })
    expect((await read(at(MON, 12))).prescription!.checkinBudgetMin).toBeUndefined()
  })

  it('(e) a read in the week after the applies-to week is not shortened', async () => {
    const nextWeek = shiftDateStr(MON, 7)
    // Served for long enough to reach it: a never-fitted plan stays as stored ...
    await pool.query(`UPDATE session_periodization SET prescription_expires_at = $3 WHERE user_id = $1 AND program_session_id = $2`,
      [USER, sessions[USER], at(shiftDateStr(MON, 10))])
    const before = await row()
    expect(JSON.stringify((await read(at(nextWeek))).prescription)).toBe(JSON.stringify(before.prescription))
    expect(await row()).toEqual(before)
    // ... and one the check-in fitted gets its own length back.
    await read(at(MON, 7))
    const served = await read(at(nextWeek))
    expect(served.prescription).toMatchObject({ durationPreset: 'standard' })
    expect(served.prescription!.checkinBudgetMin).toBeUndefined()
    expect(totalSets(served.prescription)).toBe(totalSets(before.prescription))
  })

  it('a person with no check-in: the stored-plan read is one query, as on main, and the fit adds none', async () => {
    const spy = vi.spyOn(pool, 'query')
    try {
      const before = await row(NONE)
      spy.mockClear()
      const state = await repo.getSessionPeriodization(NONE, sessions[NONE]) as SessionPeriodization
      const served = await fit(NONE, sessions[NONE], repo, TZ, state, at(MON, 7))
      expect(spy).toHaveBeenCalledTimes(1)
      expect(state.checkinSessionBudgets).toBeUndefined()
      expect(JSON.stringify(served.prescription)).toBe(JSON.stringify(before.prescription))
    } finally {
      spy.mockRestore()
    }
  })
})
