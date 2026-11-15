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
    // The switch-over's short block is gone; every row carries the program's mark and the next move.
    expect(phased.every(r => r.pendingTransition?.programPhase === true && r.pendingTransition.afterTrainingWeeks === undefined)).toBe(true)
    expect(phased.every(r => r.pendingTransition?.newPhase === 'realisation')).toBe(true)
  })

  it('a move from a phase the program has already left writes nothing (a second tap)', async () => {
    const before = await period.listSessionPeriodizationForProgram(db, USER, programId)
    const pull = before.find(r => r.programSessionId === ids.pull)!
    // Another session regenerated its plan after the first tap.
    await period.storePrescription(db, USER, ids.legs, { phase: 'intensification', phaseAction: 'stay', exercises: [] } as never, new Date(Date.now() + 86_400_000))
    const row = await period.advanceProgramPhase(db, USER, ids.pull, 'intensification', { phase: 'accumulation', phaseStartedAt: new Date('2026-11-22T14:00:00Z') })
    expect(row.phaseStartedAt.getTime()).toBe(pull.phaseStartedAt.getTime())
    const legs = (await period.getSessionPeriodization(db, USER, ids.legs))!
    expect(legs.prescription?.phase).toBe('intensification')
    expect(legs.prescriptionStatus).toBe('pending')
  })

  it('the switch-over refuses to run on a program that carries the mark', async () => {
    const wrote = await period.setProgramPhase(db, USER, programId, 'accumulation', new Date('2026-11-29T14:00:00Z'), null, { expect: 'switch-over' })
    expect(wrote).toBe(false)
    expect((await period.getSessionPeriodization(db, USER, ids.legs))!.phase).toBe('intensification')
  })

  it('a plan is stored only while the slot is still in the phase it was made for', async () => {
    const legs = (await period.getSessionPeriodization(db, USER, ids.legs))!
    const plan = { phase: 'accumulation', phaseAction: 'stay', exercises: [] } as never
    const later = new Date(Date.now() + 86_400_000)
    expect(await period.storePrescription(db, USER, ids.legs, plan, later, 'pending', { phase: 'accumulation', phaseStartedAt: legs.phaseStartedAt })).toBe(false)
    expect((await period.getSessionPeriodization(db, USER, ids.legs))!.prescription?.phase).toBe('intensification')
    expect(await period.storePrescription(db, USER, ids.legs, plan, later, 'pending', { phase: 'intensification', phaseStartedAt: legs.phaseStartedAt })).toBe(true)
  })

  it('a per-type move keeps the switch-over\'s waiting stamp, and clears the program\'s mark', async () => {
    await period.setProgramPendingTransition(db, USER, programId, { newPhase: 'accumulation', reasoning: 'wait', urgency: 'normal', switchOverPending: true, switchOverOn: '2026-11-23' })
    const kept = await period.advancePhase(db, USER, ids.legs, 'accumulation')
    expect(kept.pendingTransition).toMatchObject({ switchOverPending: true, switchOverOn: '2026-11-23' })
    await period.setProgramPendingTransition(db, USER, programId, { newPhase: 'realisation', reasoning: 'next', urgency: 'normal', programPhase: true })
    const cleared = await period.advancePhase(db, USER, ids.legs, 'realisation')
    expect(cleared.pendingTransition).toBeNull()
  })

  it('a re-align moves only the rows that were behind, and voids only their plans', async () => {
    const upper = (await period.getSessionPeriodization(db, USER, ids.upper))!
    await period.storePrescription(db, USER, ids.upper, { phase: upper.phase, phaseAction: 'stay', exercises: [] } as never, new Date(Date.now() + 86_400_000))
    await period.realignProgramPhase(db, USER, programId, {
      phase: upper.phase, phaseStartedAt: upper.phaseStartedAt,
      pendingTransition: { newPhase: 'realisation', reasoning: 'next', urgency: 'normal', programPhase: true },
    })
    const rows = await period.listSessionPeriodizationForProgram(db, USER, programId)
    const by = Object.fromEntries(rows.map(r => [r.programSessionId, r]))
    expect(by[ids.legs].phase).toBe(upper.phase) // was behind (the per-type move above)
    expect(by[ids.legs].phaseStartedAt.getTime()).toBe(upper.phaseStartedAt.getTime())
    expect(by[ids.legs].prescription).toBeNull()
    expect(by[ids.upper].prescription).not.toBeNull() // already there: its plan is kept
    expect(rows.filter(r => r.programSessionId !== ids.fresh).every(r => r.pendingTransition?.programPhase === true)).toBe(true)
  })

  it('each model answer since a moment, with when it was given', async () => {
    await pool.query(
      `INSERT INTO prescription_shadow (user_id, program_session_id, model_phase, model_phase_action, final_phase, final_phase_action, rows, created_at)
       VALUES ($1, $2, 'intensification', 'stay', 'intensification', 'stay', '[]', '2026-11-24T02:00:00Z'),
              ($1, $2, 'realisation', 'transition_recommended', 'intensification', 'stay', '[]', '2026-11-24T05:00:00Z'),
              ($1, $2, 'intensification', 'stay', 'intensification', 'stay', '[]', '2026-11-01T05:00:00Z')`,
      [USER, ids.pull],
    )
    const got = await period.listModelPhaseAnswers(db, USER, [ids.pull], new Date('2026-11-16T00:00:00Z'))
    expect(got.map(a => [a.phaseAction, a.createdAt.toISOString()])).toEqual([
      ['transition_recommended', '2026-11-24T05:00:00.000Z'],
      ['stay', '2026-11-24T02:00:00.000Z'],
    ])
  })

  it('a session type finishing its baseline joins the program where it is', async () => {
    const before = (await period.getSessionPeriodization(db, USER, ids.legs))!
    const joined = await period.setBaselineComplete(db, USER, ids.fresh, {})
    expect(joined.phase).toBe(before.phase)
    expect(joined.phaseStartedAt.getTime()).toBe(before.phaseStartedAt.getTime())
    expect(joined.pendingTransition?.programPhase).toBe(true)
  })

  it('two baselines finishing together on a new program take one phase and one start', async () => {
    const prog = await pool.query(`INSERT INTO programs (user_id, name, phase_mode) VALUES ($1, 'Program phase test 2', 'ai_dynamic') RETURNING id`, [USER])
    const pair: string[] = []
    for (const [i, name] of ['a', 'b'].entries()) {
      const ps = await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1, $2, $3) RETURNING id`, [prog.rows[0].id, name, i])
      pair.push(ps.rows[0].id)
      await pool.query(`INSERT INTO session_periodization (user_id, program_session_id) VALUES ($1, $2)`, [USER, ps.rows[0].id])
    }
    const [a, b] = await Promise.all(pair.map(id => period.setBaselineComplete(db, USER, id, {})))
    expect(a.phase).toBe('accumulation')
    expect(b.phase).toBe('accumulation')
    // Serialised by the program's row lock: the second reads the first and joins it.
    expect(a.phaseStartedAt.getTime()).toBe(b.phaseStartedAt.getTime())
    await pool.query(`DELETE FROM programs WHERE id = $1`, [prog.rows[0].id])
  })
})
