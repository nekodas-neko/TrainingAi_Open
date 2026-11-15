// #3766: one phase per program, stored by moving every `session_periodization` row of the program
// together. Integration suite against a real Postgres; skips without DATABASE_URL (CI sets it).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003766'

describe.skipIf(!canRun)('program phase storage (#3766)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let period: typeof import('@/lib/data/postgres/slices/periodization')
  let programId: string
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    const { getPool, getDb } = await import('@/lib/data/postgres/client')
    period = await import('@/lib/data/postgres/slices/periodization')
    pool = getPool()
    db = getDb()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [USER, `program-phase-${USER}@example.com`],
    )
    const prog = await pool.query(`INSERT INTO programs (user_id, name, phase_mode) VALUES ($1, 'Program phase test', 'ai_dynamic') RETURNING id`, [USER])
    programId = prog.rows[0].id
    const phases: Array<[string, string, string, number]> = [
      ['legs', 'deload', '2026-10-29T08:00:00Z', 2],
      ['pull', 'intensification', '2026-10-08T08:00:00Z', 5],
      ['upper', 'accumulation', '2026-09-10T08:00:00Z', 8],
    ]
    for (const [i, [name, phase, startedAt, n]] of phases.entries()) {
      const ps = await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1, $2, $3) RETURNING id`, [programId, name, i])
      ids[name] = ps.rows[0].id
      await pool.query(
        `INSERT INTO session_periodization (user_id, program_session_id, phase, phase_started_at, sessions_in_phase, baseline_complete, prescription, prescription_status, prescription_expires_at)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7, now() + interval '1 day')`,
        [USER, ids[name], phase, startedAt, n,
          // Pull holds an accepted one-day deload, which belongs to its day and survives a move.
          name === 'pull' ? JSON.stringify({ phase: 'intensification', phaseAction: 'deload_recommended', deload: true, exercises: [] }) : JSON.stringify({ phase, phaseAction: 'stay', deload: false, exercises: [] }),
          name === 'pull' ? 'accepted' : 'pending'],
      )
    }
    // A session type still measuring its baseline: not part of the program's phase yet.
    const fresh = await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'fresh', 9) RETURNING id`, [programId])
    ids.fresh = fresh.rows[0].id
    await pool.query(`INSERT INTO session_periodization (user_id, program_session_id) VALUES ($1, $2)`, [USER, ids.fresh])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM programs WHERE id = $1`, [programId])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('lists the program\'s completed sessions with sets, of every type, since a moment', async () => {
    const add = async (name: string, completedAt: string | null, withSets: boolean) => {
      const ws = await pool.query(
        `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [USER, ids[name], name, completedAt ?? '2026-11-20T08:00:00Z', completedAt],
      )
      if (withSets) await pool.query(`INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, logged_at) VALUES ($1, 'Squat', 100, now())`, [ws.rows[0].id])
    }
    await add('legs', '2026-11-17T08:00:00Z', true)
    await add('upper', '2026-11-18T08:00:00Z', true)
    await add('pull', '2026-11-19T08:00:00Z', false) // no sets: not a session
    await add('pull', null, true) // never completed
    await add('legs', '2026-11-01T08:00:00Z', true) // before `since`
    const got = await period.listProgramCompletions(db, USER, programId, new Date('2026-11-16T00:00:00Z'))
    expect(got.map(c => [c.programSessionId, c.completedAt.toISOString()])).toEqual([
      [ids.legs, '2026-11-17T08:00:00.000Z'],
      [ids.upper, '2026-11-18T08:00:00.000Z'],
    ])
  })

  it('moves every phased row to one phase and start, voids their plans, and keeps a held one-day deload', async () => {
    const startsAt = new Date('2026-11-22T14:00:00Z') // Monday 23 Nov, local midnight in Brisbane
    await period.setProgramPhase(db, USER, programId, 'accumulation', startsAt,
      { newPhase: 'intensification', reasoning: 'switch-over', urgency: 'normal', afterTrainingWeeks: 3 })
    const rows = await period.listSessionPeriodizationForProgram(db, USER, programId)
    const by = Object.fromEntries(rows.map(r => [r.programSessionId, r]))
    for (const name of ['legs', 'pull', 'upper']) {
      expect(by[ids[name]].phase).toBe('accumulation')
      expect(by[ids[name]].phaseStartedAt.toISOString()).toBe(startsAt.toISOString())
      expect(by[ids[name]].sessionsInPhase).toBe(0)
      expect(by[ids[name]].pendingTransition?.afterTrainingWeeks).toBe(3)
    }
    expect(by[ids.legs].prescription).toBeNull()
    expect(by[ids.legs].prescriptionStatus).toBe('consumed')
    expect(by[ids.pull].prescriptionStatus).toBe('accepted')
    expect(by[ids.pull].prescription?.phaseAction).toBe('deload_recommended')
    expect(by[ids.fresh].phase).toBe('baseline')
  })

  it('a move from one session\'s screen moves the program, voids that session\'s own plan, and clears the scheduled move', async () => {
    const row = await period.advanceProgramPhase(db, USER, ids.pull, 'intensification')
    expect(row.phase).toBe('intensification')
    expect(row.prescription).toBeNull()
    const rows = await period.listSessionPeriodizationForProgram(db, USER, programId)
    const phased = rows.filter(r => r.programSessionId !== ids.fresh)
    expect(new Set(phased.map(r => r.phase))).toEqual(new Set(['intensification']))
    expect(new Set(phased.map(r => r.phaseStartedAt.getTime())).size).toBe(1)
    expect(phased.every(r => r.pendingTransition === null)).toBe(true)
  })

  it('a session type finishing its baseline joins the program where it is', async () => {
    const before = (await period.getSessionPeriodization(db, USER, ids.legs))!
    const joined = await period.setBaselineComplete(db, USER, ids.fresh, {})
    expect(joined.phase).toBe('intensification')
    expect(joined.phaseStartedAt.getTime()).toBe(before.phaseStartedAt.getTime())
  })
})
