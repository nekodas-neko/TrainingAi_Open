// #4061: the tapped "How did it feel?" answer adjusts the next plan in rated RPE's place, against a
// real Postgres. One lift logged in three sessions of this type; the latest log carries the answer:
//   - tapped Harder and a rep short on each set: the load is cut exactly as a rated RPE at least
//     `TAPPED_HARDER_RPE_DELTA` high cuts it;
//   - tapped Easier with every rep met: the reps go up exactly as a rated RPE between
//     `TAPPED_EASIER_RPE_DELTA` and −2 low raises them.
// `set_logs.rpe` is an integer, so the rated cases use the integer inside each band (asserted).
//   - an untouched (`default`) answer, or none: the plan the model gave, as before.
//   - a log with both a rated RPE and a tapped answer: the answer wins.
// The model is a mock (0 real calls). Runs only with DATABASE_URL. Fake user and lift.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { expectedRpe } from '@trainingai/shared/ai-periodization/expected-rpe'
import { TAPPED_EASIER_RPE_DELTA, TAPPED_HARDER_RPE_DELTA } from '@trainingai/shared/ai-periodization/autoregulation'
import type { WorkoutRepository } from '@/lib/data/repository'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'

const model = vi.hoisted(() => ({ answer: null as Record<string, unknown> | null, calls: 0, prompts: [] as string[] }))
vi.mock('ai', async orig => ({
  ...(await orig<typeof import('ai')>()),
  generateObject: async (args: { prompt: string }) => {
    model.calls++
    model.prompts.push(args.prompt)
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
const USER = '00000000-0000-4000-8000-000000004061'
const LIFT = 'Effort Squat 4061'
// Hypertrophy (compound reps 5-12, so a rep push has room), 70 % × 10: an integer rating lands in
// both bands (expected 7.82 met, 6.82 a rep short).
const PCT = 70
const REPS = 10
const HIGH_RPE = 9 // a rep short: 9 − 6.82 = +2.18, at or above the Harder delta
const LOW_RPE = 6 // reps met: 6 − 7.82 = −1.82, inside (−2, Easier delta]
const HARDER_ALL_REPS = "You said it felt harder. Your logged reps were on target, so your answer doesn't change the plan."
const local = (day: string, hour: number) => new Date(dateStrMidnightInTz(day, TZ).getTime() + hour * 3_600_000)

interface Latest {
  /** The latest log's reps on each set (planned 5). */
  reps: number
  /** The latest log's per-set effort: null for the phone's untouched pre-fill, else a rated RPE. */
  rated: number | null
  effort: { vsPlan: number; source: 'tapped' | 'default' } | null
}

describe.skipIf(!canRun)('the tapped effort answer in the next plan (#4061)', () => {
  let pool: import('pg').Pool
  let repo: WorkoutRepository
  let generate: typeof import('@trainingai/shared/ai-periodization/generate-prescription').generatePrescriptionForSession
  let libId: string
  let session: string
  let lift: string

  /** A fresh user with three sessions of this type; only the latest one varies. */
  const seed = async (latest: Latest) => {
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [USER, `effort-4061@example.com`, TZ])
    const program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, created_at) VALUES ($1,'Effort test','ai_dynamic',true,'hypertrophy', now() - interval '90 days') RETURNING id`, [USER])).rows[0].id
    session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position, time_budget_minutes) VALUES ($1,'Effort Day',0,90) RETURNING id`, [program])).rows[0].id
    lift = (await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, exercise_id, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,0,'primary',$4) RETURNING id`,
      [session, LIFT, libId, ['quads']])).rows[0].id
    const today = todayInTz(TZ)
    for (const [i, back] of [9, 6, 3].entries()) {
      const day = shiftDateStr(today, -back)
      const isLatest = i === 2
      const ws = (await pool.query(
        `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Effort Day',$3,$4) RETURNING id`,
        [USER, session, local(day, 12), local(day, 13)])).rows[0].id
      const reps = isLatest ? latest.reps : REPS
      const el = (await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, estimated_1rm, logged_at, effort_vs_plan, effort_source)
         VALUES ($1,$2,$3,100,$4,$5,$6) RETURNING id`,
        [ws, LIFT, libId, local(day, 12.5), isLatest ? latest.effort?.vsPlan ?? null : null, isLatest ? latest.effort?.source ?? null : null])).rows[0].id
      const rated = isLatest ? latest.rated : null
      const rpe = rated ?? Math.round(expectedRpe(PCT, reps))
      for (let n = 1; n <= 3; n++) {
        await pool.query(
          `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, planned_reps, planned_weight_kg, planned_pct, intensity_pct, rest_time_sec, planned_rest_sec, rpe, rpe_source)
           VALUES ($1,$2,80,$3,$4,80,$5,$5,180,180,$6,$7)`, [el, n, reps, REPS, PCT, rpe, rated == null ? 'expected' : 'rated'])
      }
    }
    await pool.query(
      `INSERT INTO session_periodization (user_id, program_session_id, phase, sessions_in_phase, baseline_complete, prescription_status, last_session_ran_prescription, phase_started_at)
       VALUES ($1,$2,'accumulation',3,true,'none',true, now() - interval '30 days')`, [USER, session])
  }

  const plan = async (latest: Latest) => {
    await seed(latest)
    model.answer = {
      phase: 'accumulation', phase_action: 'stay', deload: false, reasoning: 'Steady.',
      exercises: [{ session_exercise_id: lift, name: LIFT, sets: 4, reps: REPS, pct: PCT, rest_sec: 180 }],
    }
    const res = await generate(USER, session, repo, TZ)
    expect(res.ok).toBe(true)
    const p = (res as { prescription: AiPrescription }).prescription
    const row = p.exercises.find(e => e.sessionExerciseId === lift)!
    // Each seed mints new ids; the prompt is compared with them named.
    const prompt = model.prompts.at(-1)!.replaceAll(lift, '<lift>').replaceAll(session, '<session>')
    return { pct: row.pct, reps: row.reps, sets: row.sets, note: row.autoregNote ?? null, prompt }
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    ;({ generatePrescriptionForSession: generate } = await import('@trainingai/shared/ai-periodization/generate-prescription'))
    libId = (await pool.query(
      `INSERT INTO exercise_library (name, equipment, muscles) VALUES ($1, ARRAY['barbell'], $2::jsonb)
       ON CONFLICT (name) DO UPDATE SET equipment = EXCLUDED.equipment RETURNING id`,
      [LIFT, JSON.stringify([{ muscle: 'quads', role: 'main' }])])).rows[0].id
  })

  beforeEach(() => { model.calls = 0; model.prompts = [] })

  afterAll(async () => {
    await pool?.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool?.query(`DELETE FROM exercise_library WHERE name = $1`, [LIFT])
  })

  const untouched = { rated: null, effort: null }

  it('the rated fixtures sit inside the bands the tapped answers are declared equal to', () => {
    expect(HIGH_RPE - expectedRpe(PCT, REPS - 1)).toBeGreaterThanOrEqual(TAPPED_HARDER_RPE_DELTA)
    expect(LOW_RPE - expectedRpe(PCT, REPS)).toBeLessThanOrEqual(TAPPED_EASIER_RPE_DELTA)
    expect(LOW_RPE - expectedRpe(PCT, REPS)).toBeGreaterThan(-2)
  })

  it('tapped Harder with a missed rep cuts the load as the rated RPE does', async () => {
    const tapped = await plan({ ...untouched, reps: REPS - 1, effort: { vsPlan: 1, source: 'tapped' } })
    const rated = await plan({ reps: REPS - 1, rated: HIGH_RPE, effort: null })
    const none = await plan({ ...untouched, reps: REPS - 1 })
    expect(tapped.pct).toBeLessThan(PCT)
    expect({ ...tapped, note: null, prompt: null }).toEqual({ ...rated, note: null, prompt: null })
    expect(tapped.note).toMatch(/^−\d+(\.\d)?% load — it felt harder than expected and you fell short of the prescribed reps$/)
    expect(rated.note).toBe(tapped.note!.replace('it felt harder than expected', 'RPE ran high'))
    expect(none).toMatchObject({ pct: PCT, reps: REPS, note: null })
    expect(tapped.prompt).toContain(`Effort answer (the lifter's tap after the lift's last set, latest session; read in place of RPE for that lift): ${LIFT}: harder than expected`)
    expect(none.prompt).not.toContain('Effort answer')
  })

  it('tapped Easier with every rep met bumps as the rated RPE does', async () => {
    const tapped = await plan({ ...untouched, reps: REPS, effort: { vsPlan: -1, source: 'tapped' } })
    const rated = await plan({ reps: REPS, rated: LOW_RPE, effort: null })
    expect(tapped.reps).toBeGreaterThan(REPS)
    expect({ ...tapped, prompt: null }).toEqual({ ...rated, prompt: null })
    expect(tapped.prompt).toContain(`${LIFT}: easier than expected`)
  })

  it('an untouched default answer, or tapped Harder alone, leaves the plan as the model gave it', async () => {
    const none = await plan({ ...untouched, reps: REPS - 1 })
    const dflt = await plan({ ...untouched, reps: REPS - 1, effort: { vsPlan: 0, source: 'default' } })
    expect(dflt).toEqual(none)
    expect(none).toMatchObject({ pct: PCT, reps: REPS, note: null })
    // #4079: the figures stay the model's; the note now says the tap was read.
    const harderAlone = await plan({ ...untouched, reps: REPS, effort: { vsPlan: 1, source: 'tapped' } })
    expect(harderAlone).toMatchObject({ pct: PCT, reps: REPS, sets: none.sets, note: HARDER_ALL_REPS })
  })

  it('a log with both a rated RPE and a tapped answer: the answer wins', async () => {
    // Rated running high with a miss would cut; the tapped As expected is no signal and wins.
    const ratedOnly = await plan({ reps: REPS - 1, rated: HIGH_RPE, effort: null })
    expect(ratedOnly.pct).toBeLessThan(PCT)
    const both = await plan({ reps: REPS - 1, rated: HIGH_RPE, effort: { vsPlan: 0, source: 'tapped' } })
    expect(both).toMatchObject({ pct: PCT, reps: REPS, note: null })
    // Rated low (would bump with reps met) and tapped Harder: Harder wins, and alone it moves nothing.
    const ratedLow = await plan({ reps: REPS, rated: LOW_RPE, effort: null })
    expect(ratedLow.reps).toBeGreaterThan(REPS)
    const lowButHarder = await plan({ reps: REPS, rated: LOW_RPE, effort: { vsPlan: 1, source: 'tapped' } })
    expect(lowButHarder).toMatchObject({ pct: PCT, reps: REPS, note: HARDER_ALL_REPS })
    expect(model.calls).toBe(4)
  })

  // #4079: a tapped answer the rule read and changed nothing for is said in the lift's note.
  it('tapped Harder with every rep done: the plan is the model\'s, and the note says the tap was read', async () => {
    const none = await plan({ ...untouched, reps: REPS })
    const harder = await plan({ ...untouched, reps: REPS, effort: { vsPlan: 1, source: 'tapped' } })
    // Sets, reps, load: the plan the model gave, as with no answer. Only the note differs.
    expect({ ...harder, note: null, prompt: null }).toEqual({ ...none, note: null, prompt: null })
    expect(harder.pct).toBe(PCT)
    expect(harder.reps).toBe(REPS)
    expect(harder.note).toBe(HARDER_ALL_REPS)
    expect(none.note).toBeNull()
  })

  it('tapped Easier with a missed rep: the answer changes nothing and the note says why', async () => {
    const none = await plan({ ...untouched, reps: REPS - 1 })
    const easier = await plan({ ...untouched, reps: REPS - 1, effort: { vsPlan: -1, source: 'tapped' } })
    expect({ ...easier, note: null, prompt: null }).toEqual({ ...none, note: null, prompt: null })
    expect(easier.note).toBe("You said it felt easier, but your logged reps fell short of your target, so your answer doesn't change the plan.")
  })

  it('As expected adds no note; a tap that changed the plan keeps the rule\'s own note', async () => {
    expect((await plan({ ...untouched, reps: REPS, effort: { vsPlan: 0, source: 'tapped' } })).note).toBeNull()
    expect((await plan({ ...untouched, reps: REPS, effort: { vsPlan: 0, source: 'default' } })).note).toBeNull()
    const cut = await plan({ ...untouched, reps: REPS - 1, effort: { vsPlan: 1, source: 'tapped' } })
    expect(cut.note).toMatch(/^−\d+(\.\d)?% load — it felt harder than expected and you fell short of the prescribed reps$/)
    expect(cut.note).not.toMatch(/You said/)
  })

  it('the read is owner-scoped: another user\'s session ids give nothing', async () => {
    await seed({ ...untouched, reps: REPS, effort: { vsPlan: 1, source: 'tapped' } })
    const ids = (await pool.query(`SELECT id FROM workout_sessions WHERE user_id = $1`, [USER])).rows.map(r => r.id as string)
    expect((await repo.getLatestExerciseEfforts!(USER, ids, [LIFT])).get(LIFT)).toEqual({ vsPlan: 1, source: 'tapped' })
    expect((await repo.getLatestExerciseEfforts!('00000000-0000-4000-8000-0000000040ff', ids, [LIFT])).size).toBe(0)
  })
})
