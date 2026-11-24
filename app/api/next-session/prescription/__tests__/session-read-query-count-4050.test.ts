// #4050 / #4019 item 4: what one read of a program's next session costs, in database statements, for the
// three readers of "what will this session's lifts be": the session screen (`/api/workout-data`, one
// session), the Next workout card (`/api/next-session/prescription`) and the Coach's context line
// (`/api/coach/about`, opened from a lift). The routes run for real, against a real Postgres, for a manual,
// an automatic and an AI-planned program; every statement the process sends is counted at the driver
// (`pg.Client.prototype.query`, which `Pool.query` and a transaction both go through), after the
// fire-and-forget writes a read may start have settled.
//
// A ceiling per cell, so a change that adds a statement fails here. The automatic program's phases and its
// sessions' counts are ONE statement (`getProgramPhaseState`): before #4050 they were 5 on each route, so
// the automatic cells went 19 / 20 / 20 to 15 / 16 / 16 and the others did not move.
// Runs only against a real Postgres (DATABASE_URL). Made-up names and numbers only.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'

const authUser = { id: '' }
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: authUser.id, timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
// No model call: a read that would regenerate a plan is refused here and counted.
const model = { calls: 0 }
vi.mock('@trainingai/shared/ai-periodization/regenerate-in-background', () => ({ regeneratePrescriptionInBackground: () => { model.calls++ } }))
vi.mock('@trainingai/shared/ai-periodization/generate-prescription', () => ({ generatePrescriptionForSession: async () => { model.calls++ } }))

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const U = { manual: '00000000-0000-4000-8000-0000405000a1', automatic: '00000000-0000-4000-8000-0000405000a2', ai: '00000000-0000-4000-8000-0000405000a3' }
const LIFT = 'Query Count Press 4050'
const ACC = 'Query Count Curl 4050'
type Kind = keyof typeof U

/** The most statements one read may send, per route and program kind. Lower the number when a read gets cheaper. */
const CEILING: Record<'screen' | 'card' | 'coach', Record<Kind, number>> = {
  // main before #4050: screen 14 / 19 / 21, card 15 / 20 / 36, coach 15 / 20 / 11 (manual / automatic / AI-planned).
  screen: { manual: 14, automatic: 15, ai: 21 },
  card: { manual: 15, automatic: 16, ai: 36 },
  coach: { manual: 15, automatic: 16, ai: 11 },
}

describe.skipIf(!canRun)('what a session read costs in statements (#4050)', () => {
  let pool: import('pg').Pool
  let pg: typeof import('pg')
  const ids = {} as Record<Kind, { program: string; session: string; lift: string }>
  let libIds: string[] = []
  const table: string[] = []

  /** Statements sent while `fn` runs and the writes it starts settle. */
  async function statements(fn: () => Promise<Response>): Promise<number> {
    const spy = vi.spyOn(pg.Client.prototype, 'query')
    try {
      const res = await fn()
      expect(res.status).toBe(200)
      await res.json()
      await new Promise(r => setTimeout(r, 300))
      return spy.mock.calls.length
    } finally { spy.mockRestore() }
  }

  const routes = {
    screen: async (k: Kind) => (await import('@/app/api/workout-data/route')).GET(new NextRequest(`http://localhost/api/workout-data?session=${ids[k].session}&poll=1`)),
    card: async () => (await import('@/app/api/next-session/prescription/route')).GET(),
    coach: async (k: Kind) => (await import('@/app/api/coach/about/route')).GET(new Request(
      `http://localhost/api/coach/about?origin=exercise&sessionExerciseId=${ids[k].lift}&programSessionId=${ids[k].session}`)),
  }

  beforeAll(async () => {
    pg = await import('pg')
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [Object.values(U)])
    for (const id of Object.values(U)) {
      await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [id, `qc-4050-${id}@example.com`, TZ])
    }
    libIds = (await Promise.all([LIFT, ACC].map(async n => (await pool.query(
      `INSERT INTO exercise_library (name, equipment) VALUES ($1, ARRAY['Barbell']) ON CONFLICT (name) DO UPDATE SET equipment = EXCLUDED.equipment RETURNING id`, [n])).rows[0].id as string)))
    for (const kind of Object.keys(U) as Kind[]) {
      const user = U[kind]
      const style = (await pool.query(`INSERT INTO progression_styles (user_id, name) VALUES ($1,'Eights') RETURNING id`, [user])).rows[0].id
      for (let n = 1; n <= 3; n++) await pool.query(`INSERT INTO style_sets (style_id, set_number, pct, reps, rest_sec) VALUES ($1,$2,75,8,120)`, [style, n])
      let phaseSet: string | null = null
      if (kind === 'automatic') {
        phaseSet = (await pool.query(`INSERT INTO phase_sets (user_id, name) VALUES ($1,'QC set') RETURNING id`, [user])).rows[0].id
        for (const [i, [name, type]] of [['Build', 'normal'], ['Deload', 'deload'], ['Baseline', 'baseline']].entries()) {
          await pool.query(`INSERT INTO program_phases (phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id) VALUES ($1,$2,$3,2,$4,$5,$5)`,
            [phaseSet, i, name, type, style])
        }
      }
      const program = (await pool.query(
        `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, phase_set_id, started_at) VALUES ($1,'QC','${kind === 'ai' ? 'ai_dynamic' : kind}',true,'strength',$2,$3) RETURNING id`,
        [user, phaseSet, kind === 'automatic' ? '2026-10-01' : null])).rows[0].id
      const session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Push',0) RETURNING id`, [program])).rows[0].id
      const lift = (await pool.query(`INSERT INTO session_exercises (session_id, exercise_name, exercise_id, style_id, position, exercise_role) VALUES ($1,$2,$3,$4,0,'primary') RETURNING id`, [session, LIFT, libIds[0], style])).rows[0].id
      await pool.query(`INSERT INTO session_exercises (session_id, exercise_name, exercise_id, style_id, position, exercise_role) VALUES ($1,$2,$3,$4,1,'accessory')`, [session, ACC, libIds[1], style])
      await pool.query(`INSERT INTO exercise_estimates (user_id, exercise_name, exercise_id, estimated_1rm) VALUES ($1,$2,$3,100)`, [user, LIFT, libIds[0]])
      // Some history, so the session counts have rows to group.
      for (let d = 1; d <= 3; d++) {
        await pool.query(`INSERT INTO workout_sessions (user_id, session_id, session_name, started_at) VALUES ($1,$2,'Push', now() - ($3 || ' days')::interval)`, [user, session, String(d * 3)])
      }
      if (kind === 'ai') {
        const plan = {
          phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: '', confidence: 1, source: 'model',
          estimatedSessionDurationMin: 45, weeklyVolumeContribution: {},
          exercises: [{ sessionExerciseId: lift, name: LIFT, sets: 3, reps: 5, pct: 80, restSec: 150 }],
        }
        await pool.query(
          `INSERT INTO session_periodization (user_id, program_session_id, phase, prescription, prescription_status, baseline_complete, prescription_generated_at, prescription_expires_at)
           VALUES ($1,$2,'accumulation',$3,'accepted',true, now(), now() + interval '3 days')`, [user, session, JSON.stringify(plan)])
      }
      ids[kind] = { program, session, lift }
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [Object.values(U)])
    await pool.query(`DELETE FROM exercise_library WHERE id = ANY($1)`, [libIds])
    console.info(`[#4050 statements per read]\n${table.join('\n')}`)
  })

  for (const kind of Object.keys(U) as Kind[]) {
    for (const route of ['screen', 'card', 'coach'] as const) {
      it(`${route} · ${kind}: within its ceiling, no model call`, async () => {
        authUser.id = U[kind]
        const run = () => route === 'card' ? routes.card() : routes[route](kind)
        await run() // the first read warms the module and the schema; the one counted is the steady state
        await new Promise(r => setTimeout(r, 300)) // and lets the writes it started (a plan's re-check stamp) land first
        model.calls = 0
        const n = await statements(run as () => Promise<Response>)
        table.push(`${route.padEnd(6)} ${kind.padEnd(10)} ${n}`)
        expect(model.calls).toBe(0)
        expect(n).toBeLessThanOrEqual(CEILING[route][kind])
      })
    }
  }
})
