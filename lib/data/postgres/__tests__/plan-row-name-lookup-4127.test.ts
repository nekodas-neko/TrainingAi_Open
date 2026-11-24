// Review of #4127 (c): the Coach's restate of a spent one-off finds a stored plan's row BY NAME
// (`restateSpentOneShot`'s `carries` filter). A row now carries the lift's own name, so a row the model
// had re-cased or padded is found and restated to the lift's lasting preference (here a 10-13 rep range);
// on `main` it was missed and kept its spent one-off. The exact echo is the control (same on both).
// The Coach's apply (`restatePlan`) matches rows by session-exercise id, so it never depended on names.
// Runs only against a real Postgres (DATABASE_URL). 0 model requests. Made-up names and numbers.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { reconcilePrescription } from '@trainingai/shared/ai-periodization/reconcile-prescription'

const canRun = !!process.env.DATABASE_URL
const U = '00000000-0000-4000-8000-0000041275a1'
const LIFT = 'Row Name Lookup Pulldown 4127'
const SPENT = '2026-11-20T01:02:03.000Z'
const ECHOES = { exact: LIFT, recased: LIFT.toUpperCase(), padded: `  ${LIFT}  ` } as const

describe.skipIf(!canRun)('Coach restate of a spent one-off finds a row the model re-cased or padded (#4127 review)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let repo: import('@/lib/data/repository').WorkoutRepository
  let libId: string
  const sessions = {} as Record<keyof typeof ECHOES, { session: string; exercise: string }>

  const planFor = (echo: string, exerciseId: string) => {
    const r = reconcilePrescription({
      modelPhase: 'accumulation', phaseAction: 'stay', currentPhase: 'accumulation',
      modelExercises: [{ sessionExerciseId: exerciseId, name: echo, sets: 3, reps: 8, pct: 70, restSec: 120 }],
      signalExercises: [{ sessionExerciseId: exerciseId, name: LIFT, role: 'secondary' }],
      trainingGoal: 'strength', deloadedIds: new Set(), deloadOverride: { sets: 2, reps: 5, pct: 55, restSec: 90 },
    })
    return {
      phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: '', confidence: 1,
      estimatedSessionDurationMin: 45, weeklyVolumeContribution: {},
      exercises: r.exercises.map(e => ({ ...e, liftPreference: { loadStep: 'lighter', oneShotSetAt: SPENT } })),
    }
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    db = client.getDb()
    repo = await (await import('@/lib/data')).getRepository()
    await pool.query(`DELETE FROM users WHERE id = $1`, [U])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x','Australia/Brisbane')`, [U, `row-name-4127-${U}@example.com`])
    libId = (await pool.query(
      `INSERT INTO exercise_library (name, equipment) VALUES ($1, ARRAY['Cable']) ON CONFLICT (name) DO UPDATE SET equipment = EXCLUDED.equipment RETURNING id`, [LIFT])).rows[0].id
    const program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal) VALUES ($1,'Row names','ai_dynamic',true,'strength') RETURNING id`, [U])).rows[0].id
    await pool.query(`INSERT INTO exercise_estimates (user_id, exercise_name, exercise_id, estimated_1rm) VALUES ($1,$2,$3,100)`, [U, LIFT, libId])
    // The lifter's lasting preference: a 10-13 rep range. The one-off ("lighter next time") was used up.
    await pool.query(`INSERT INTO exercise_preferences (user_id, exercise_id, exercise_name, rep_min, rep_max, source) VALUES ($1,$2,$3,10,13,'coach')`, [U, libId, LIFT])
    let pos = 0
    for (const kind of Object.keys(ECHOES) as Array<keyof typeof ECHOES>) {
      const session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,$2,$3) RETURNING id`, [program, `Day ${kind}`, pos++])).rows[0].id
      const exercise = (await pool.query(
        `INSERT INTO session_exercises (session_id, exercise_name, exercise_id, position, exercise_role) VALUES ($1,$2,$3,0,'secondary') RETURNING id`, [session, LIFT, libId])).rows[0].id
      sessions[kind] = { session, exercise }
      await pool.query(
        `INSERT INTO session_periodization (user_id, program_session_id, phase, prescription, prescription_status, baseline_complete, prescription_generated_at, prescription_expires_at)
         VALUES ($1,$2,'accumulation',$3,'accepted',true, now(), now() + interval '3 days')`,
        [U, session, JSON.stringify(planFor(ECHOES[kind], exercise))])
    }
  })
  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [U])
    await pool.query(`DELETE FROM exercise_library WHERE id = $1`, [libId])
  })

  const rowOf = async (kind: keyof typeof ECHOES) =>
    (await pool.query(`SELECT prescription FROM session_periodization WHERE user_id = $1 AND program_session_id = $2`, [U, sessions[kind].session])).rows[0].prescription.exercises[0]

  it('every stored row carries the lift\'s own name, and starts with the spent one-off on 3 x 8', async () => {
    for (const kind of Object.keys(ECHOES) as Array<keyof typeof ECHOES>) {
      expect(await rowOf(kind)).toMatchObject({ name: LIFT, reps: 8, liftPreference: { loadStep: 'lighter', oneShotSetAt: SPENT } })
    }
  })

  it('restating the spent one-off takes it off and puts the lasting 10-13 range on every row, whatever the model echoed', async () => {
    const { restateSpentOneShot } = await import('@/lib/coach/domains/lift-preference')
    const rewritten = await restateSpentOneShot(db, repo, U, LIFT, new Date(SPENT))
    expect(rewritten).toBe(3) // main: 1 (the exact echo only)
    for (const kind of Object.keys(ECHOES) as Array<keyof typeof ECHOES>) {
      const row = await rowOf(kind)
      expect(row.reps, kind).toBe(10)
      expect(row.liftPreference?.loadStep, kind).toBeUndefined()
      expect(row.liftPreference?.oneShotSetAt, kind).toBeUndefined()
      expect(row.liftPreference, kind).toMatchObject({ repRange: { min: 10, max: 13 } })
    }
  })
})
