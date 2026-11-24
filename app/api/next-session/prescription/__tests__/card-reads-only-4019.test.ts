// #4019 item 2, at the database driver: the Next workout card re-evaluates a stored AI plan against today's
// soreness, and that is a READ. On a real Postgres, with a plan that today's check-in lightens and that has not
// yet been re-checked for today, the card is read with every statement the process sends logged
// (`pg.Client.prototype.query`): there is no INSERT, UPDATE or DELETE, no regeneration starts, no model is
// called (a model mock throws), and the stored plan row is byte-identical afterwards. The session screen, read
// next, shows the same lifts and does store the re-check. Made-up names and numbers only.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { prescribedBar } from '@trainingai/shared/workout/load-rounding'
import { todayInTz } from '@trainingai/shared/date-utils'

const authUser = { id: '' }
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: authUser.id, timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
const model = { calls: 0 }
vi.mock('@trainingai/shared/ai-periodization/regenerate-in-background', () => ({ regeneratePrescriptionInBackground: () => { model.calls++ } }))
vi.mock('@trainingai/shared/ai-periodization/generate-prescription', () => ({ generatePrescriptionForSession: async () => { model.calls++ } }))
vi.mock('ai', async importOriginal => ({ ...(await importOriginal<typeof import('ai')>()), generateText: () => { model.calls++; throw new Error('a model was called') } }))

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const USER = '00000000-0000-4000-8000-0000401900a1'
const LIFT = 'Card Reads Only Press 4019'
const OTHER = 'Card Reads Only Row 4019'

describe.skipIf(!canRun)('the card re-evaluates today\'s soreness without writing (#4019)', () => {
  let pool: import('pg').Pool
  let pg: typeof import('pg')
  const ids = {} as { session: string; lift: string; other: string }
  let libIds: string[] = []
  const planRow = async () => (await pool.query(`SELECT prescription, prescription_status, updated_at::text FROM session_periodization WHERE user_id = $1`, [USER])).rows[0]

  beforeAll(async () => {
    pg = await import('pg')
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,'card-reads-only-4019@example.com','x',$2)`, [USER, TZ])
    libIds = await Promise.all([LIFT, OTHER].map(async n => (await pool.query(
      `INSERT INTO exercise_library (name, equipment) VALUES ($1, ARRAY['Barbell']) ON CONFLICT (name) DO UPDATE SET equipment = EXCLUDED.equipment RETURNING id`, [n])).rows[0].id as string))
    // Chest is the main muscle of the pressing lift: a sore chest lightens it, and leaves the row alone.
    await pool.query(`INSERT INTO exercise_muscles (exercise_id, muscle, role) SELECT $1, 'Chest', 'main' WHERE NOT EXISTS (SELECT 1 FROM exercise_muscles WHERE exercise_id = $1)`, [libIds[0]]).catch(() => {})
    await pool.query(`INSERT INTO exercise_muscles (exercise_id, muscle, role) SELECT $1, 'Lats', 'main' WHERE NOT EXISTS (SELECT 1 FROM exercise_muscles WHERE exercise_id = $1)`, [libIds[1]]).catch(() => {})
    const style = (await pool.query(`INSERT INTO progression_styles (user_id, name) VALUES ($1,'Eights') RETURNING id`, [USER])).rows[0].id
    for (let n = 1; n <= 3; n++) await pool.query(`INSERT INTO style_sets (style_id, set_number, pct, reps, rest_sec) VALUES ($1,$2,75,8,120)`, [style, n])
    const program = (await pool.query(`INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal) VALUES ($1,'Reads only','ai_dynamic',true,'strength') RETURNING id`, [USER])).rows[0].id
    ids.session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Push',0) RETURNING id`, [program])).rows[0].id
    ids.lift = (await pool.query(`INSERT INTO session_exercises (session_id, exercise_name, exercise_id, style_id, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,$4,0,'primary', ARRAY['Chest']) RETURNING id`, [ids.session, LIFT, libIds[0], style])).rows[0].id
    ids.other = (await pool.query(`INSERT INTO session_exercises (session_id, exercise_name, exercise_id, style_id, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,$4,1,'secondary', ARRAY['Lats']) RETURNING id`, [ids.session, OTHER, libIds[1], style])).rows[0].id
    for (const [n, l] of [[LIFT, libIds[0]], [OTHER, libIds[1]]] as const) {
      await pool.query(`INSERT INTO exercise_estimates (user_id, exercise_name, exercise_id, estimated_1rm) VALUES ($1,$2,$3,100)`, [USER, n, l])
    }
    const plan = {
      phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: '', confidence: 1, source: 'model',
      estimatedSessionDurationMin: 45, weeklyVolumeContribution: {},
      exercises: [
        { sessionExerciseId: ids.lift, name: LIFT, sets: 3, reps: 5, pct: 82.5, restSec: 150 },
        { sessionExerciseId: ids.other, name: OTHER, sets: 3, reps: 8, pct: 70, restSec: 120 },
      ],
    }
    await pool.query(
      `INSERT INTO session_periodization (user_id, program_session_id, phase, prescription, prescription_status, baseline_complete, prescription_generated_at, prescription_expires_at)
       VALUES ($1,$2,'accumulation',$3,'accepted',true, now() - interval '1 day', now() + interval '3 days')`, [USER, ids.session, JSON.stringify(plan)])
    // Today's check-in: a sore chest, reported by the lifter.
    await pool.query(`INSERT INTO mood_logs (user_id, log_date, energy_level, sleep_quality, body_state, sore_muscles) VALUES ($1,$2,'ok','ok',ARRAY['sore_muscles'],ARRAY['Chest'])`, [USER, todayInTz(TZ)])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.query(`DELETE FROM exercise_library WHERE id = ANY($1)`, [libIds])
  })

  async function logged<T>(fn: () => Promise<T>): Promise<{ result: T; sql: string[] }> {
    const spy = vi.spyOn(pg.Client.prototype, 'query')
    try {
      const result = await fn()
      await new Promise(r => setTimeout(r, 300))
      return { result, sql: spy.mock.calls.map(c => String((c[0] as { text?: string })?.text ?? c[0])) }
    } finally { spy.mockRestore() }
  }
  const card = async () => (await (await import('@/app/api/next-session/prescription/route')).GET()).json() as Promise<{ exercises: Array<{ name: string; sets: Array<{ weightKg: number | null; reps: number; restSec: number }> }> }>
  const screen = async () => (await (await import('@/app/api/workout-data/route')).GET(new NextRequest(`http://localhost/api/workout-data?session=${ids.session}&poll=1`))).json() as Promise<{
    exercises: Array<{ name: string; estimated1rm: number; equipment?: string[]; progressionStyle: Array<{ pct: number; reps: number; restSec: number }> }> }>

  it('writes nothing, calls no model, and shows what the screen then shows', async () => {
    authUser.id = USER
    await card() // warm the module and schema
    const before = await planRow()
    const { result: cardBody, sql } = await logged(card)
    const writes = sql.filter(q => /^\s*(insert|update|delete)\b/i.test(q))
    console.info(`[#4019 item 2] card read: ${sql.length} statements, ${writes.length} writes`)
    expect(writes).toEqual([])
    expect(model.calls).toBe(0)
    expect(await planRow()).toEqual(before) // the stored plan is exactly as it was

    // The sore chest lightened the pressing lift on the card, and the other lift is as the plan wrote it.
    const stored = (before.prescription as { exercises: Array<{ pct: number }> }).exercises
    const press = cardBody.exercises.find(e => e.name === LIFT)!
    expect(press.sets[0].weightKg).not.toBe(prescribedBar(100, stored[0].pct, ['Barbell']))
    expect(cardBody.exercises.find(e => e.name === OTHER)!.sets[0].weightKg).toBe(prescribedBar(100, 70, ['Barbell']))

    // The screen, read next, shows the same lifts, and is the one that stores the re-check.
    const screenBody = await screen()
    for (const ex of screenBody.exercises) {
      const onCard = cardBody.exercises.find(c => c.name === ex.name)!
      expect(onCard.sets).toEqual(ex.progressionStyle.map(s => ({ weightKg: prescribedBar(ex.estimated1rm, s.pct, ex.equipment), reps: s.reps, restSec: s.restSec })))
    }
    await new Promise(r => setTimeout(r, 300))
    expect((await planRow()).prescription).not.toEqual(before.prescription)
    expect(model.calls).toBe(0)
  })
})
