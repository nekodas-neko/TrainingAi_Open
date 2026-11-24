// #4114 items 3 and 4: what the daily digest and `?tab=meta` cost in database statements, and that the phase they
// report is the one the two reads they used to make would have given. The routes run for real against a real
// Postgres for an automatic program with phases and some completed sessions; statements are counted at the driver
// (`pg.Client.prototype.query`). The digest read phases and counts with `listProgramPhases` and
// `countAllSessionsSinceStart` (5 statements); it now reads `getProgramPhaseState` (1).
// Runs only against a real Postgres (DATABASE_URL). Made-up names and numbers only.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { buildAutomaticPhaseStatus } from '@trainingai/shared/phase-engine'
import { getScheduledSessionsPerWeek } from '@trainingai/shared/schedule-utils'
import { todayInTz } from '@trainingai/shared/date-utils'

const authUser = { id: '' }
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: authUser.id, timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const USER = '00000000-0000-4000-8000-0000411400a1'

/**
 * The statements that read a program's phases or the grouped session counts. `getProgramPhaseState` sends one; the
 * digest's `listProgramPhases` + `countAllSessionsSinceStart` sent two of these and three more to re-read the program
 * row and its session names (5 in all, so the digest's 20 statements became 16).
 */
const PHASE_STATEMENTS_CEILING = 1
/** The most statements a whole digest read may send. On main it sent 20: the five above were the phase part. */
const DIGEST_CEILING = 16

describe.skipIf(!canRun)('the digest and ?tab=meta read a program\'s phases once (#4114)', () => {
  let pool: import('pg').Pool
  let pg: typeof import('pg')
  let repo: import('@/lib/data/repository').WorkoutRepository
  let programId = ''

  beforeAll(async () => {
    pg = await import('pg')
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    repo = await (await import('@/lib/data')).getRepository()
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,'phase-read-4114@example.com','x',$2)`, [USER, TZ])
    const style = (await pool.query(`INSERT INTO progression_styles (user_id, name) VALUES ($1,'Eights') RETURNING id`, [USER])).rows[0].id
    await pool.query(`INSERT INTO style_sets (style_id, set_number, pct, reps, rest_sec) VALUES ($1,1,75,8,120)`, [style])
    const phaseSet = (await pool.query(`INSERT INTO phase_sets (user_id, name) VALUES ($1,'Phase read set') RETURNING id`, [USER])).rows[0].id
    for (const [i, [name, type]] of [['Build', 'normal'], ['Deload', 'deload'], ['Baseline', 'baseline']].entries()) {
      await pool.query(`INSERT INTO program_phases (phase_set_id, position, name, duration_cycles, phase_type, primary_style_id, secondary_style_id) VALUES ($1,$2,$3,2,$4,$5,$5)`, [phaseSet, i, name, type, style])
    }
    programId = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, phase_set_id, started_at) VALUES ($1,'Phase read','automatic',true,'strength',$2,'2026-10-01') RETURNING id`, [USER, phaseSet])).rows[0].id
    const session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Push',0) RETURNING id`, [programId])).rows[0].id
    await pool.query(`INSERT INTO session_exercises (session_id, exercise_name, style_id, position, exercise_role) VALUES ($1,'Phase Read Press 4114',$2,0,'primary')`, [session, style])
    // Two earlier workouts and one today, so the digest has a session to report and the counts have rows.
    for (const days of [9, 5, 0]) {
      const ws = (await pool.query(`INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Push', now() - ($3 || ' hours')::interval, now() - ($3 || ' hours')::interval + interval '40 minutes') RETURNING id`, [USER, session, String(days * 24 + (days === 0 ? 0 : 0))])).rows[0].id
      await pool.query(`INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, logged_at) VALUES ($1,'Phase Read Press 4114',1000, now() - ($2 || ' hours')::interval)`, [ws, String(days * 24)])
    }
  })

  afterAll(async () => { if (canRun) await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) })

  async function statementsOf(fn: () => Promise<Response>): Promise<{ n: number; body: Record<string, unknown>; sql: string[] }> {
    const spy = vi.spyOn(pg.Client.prototype, 'query')
    try {
      const res = await fn()
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      await new Promise(r => setTimeout(r, 200))
      return { n: spy.mock.calls.length, body, sql: spy.mock.calls.map(c => String((c[0] as { text?: string })?.text ?? c[0])) }
    } finally { spy.mockRestore() }
  }
  const digest = async () => (await import('@/app/api/daily-digest/route')).POST(new Request('http://localhost/api/daily-digest', { method: 'POST' }) as never)
  const meta = async () => (await import('@/app/api/workout-data/route')).GET(new NextRequest('http://localhost/api/workout-data?tab=meta'))
  const phaseStatements = (sql: string[]) => sql.filter(q => /program_phases|count\(\*\)::int/i.test(q)).length

  it('the digest: one phase read, and the phase it names is the one the old two reads give', async () => {
    authUser.id = USER
    await digest() // warm the module and schema; the counted read is the steady state
    const { n, body, sql } = await statementsOf(digest)
    // The old way, through the repository's own two functions (still there for other callers).
    const program = (await repo.getActiveProgram(USER))!
    const phases = await repo.listProgramPhases(USER, programId)
    const counts = await repo.countAllSessionsSinceStart(USER, programId)
    const perWeek = getScheduledSessionsPerWeek(program) / Math.max(1, program.sessions.length)
    const old = buildAutomaticPhaseStatus(phases, counts.get(program.sessions[0].id) ?? 0, program, todayInTz(TZ), perWeek)
    expect(String(body.digest)).toContain(`${old.phase.name} phase`)
    expect(phaseStatements(sql)).toBeLessThanOrEqual(PHASE_STATEMENTS_CEILING)
    expect(n).toBeLessThanOrEqual(DIGEST_CEILING)
    console.info(`[#4114] digest: ${n} statements in all, ${phaseStatements(sql)} for phases and counts\n` + sql.map(q => q.slice(0, 110).replace(/\s+/g, ' ')).join('\n'))
  })

  it('?tab=meta: one phase read, and every session\'s status is the one the old loop gives', async () => {
    authUser.id = USER
    await meta()
    const { n, body, sql } = await statementsOf(meta)
    const program = (await repo.getActiveProgram(USER))!
    const phases = await repo.listProgramPhases(USER, programId)
    const counts = await repo.countAllSessionsSinceStart(USER, programId)
    const perWeek = getScheduledSessionsPerWeek(program) / Math.max(1, program.sessions.length)
    const expected = program.sessions.map(s => ({ sessionId: s.id, sessionName: s.name,
      phaseStatus: buildAutomaticPhaseStatus(phases, counts.get(s.id) ?? 0, program, todayInTz(TZ), perWeek) }))
    expect(body.perSessionPhaseStatus).toEqual(JSON.parse(JSON.stringify(expected)))
    expect(phaseStatements(sql)).toBeLessThanOrEqual(PHASE_STATEMENTS_CEILING)
    console.info(`[#4114] ?tab=meta: ${n} statements in all, ${phaseStatements(sql)} for phases and counts`)
  })
})
