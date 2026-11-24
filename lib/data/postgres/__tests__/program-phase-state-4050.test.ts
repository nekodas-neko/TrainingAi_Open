// #4050: `getProgramPhaseState` returns, in one statement, what `listProgramPhases` and
// `countAllSessionsSinceStart` returned in five: the same phases in the same order, the same counts
// (by program-session id, legacy null-id rows matched by name, early-deload and deleted rows left out,
// only rows after the cycle anchor), and nothing for a program or phase set that is not the caller's.
// Runs only against a real Postgres (DATABASE_URL). Made-up names only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const A = '00000000-0000-4000-8000-0000405100a1'
const B = '00000000-0000-4000-8000-0000405100b2'

describe.skipIf(!canRun)('getProgramPhaseState equals the two reads it replaces (#4050)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let slice: typeof import('@/lib/data/postgres/slices/programs')
  let program: string, plain: string, foreign: string
  let push: string, pull: string

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool(); db = client.getDb()
    slice = await import('@/lib/data/postgres/slices/programs')
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[A, B]])
    for (const id of [A, B]) await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x','Australia/Brisbane')`, [id, `ps-4050-${id}@example.com`])
    const set = async (user: string, name: string) => {
      const id = (await pool.query(`INSERT INTO phase_sets (user_id, name) VALUES ($1,$2) RETURNING id`, [user, name])).rows[0].id as string
      // Inserted out of order: the read is by position.
      for (const [pos, n, type] of [[2, 'Test', 'testing'], [0, 'Build', 'normal'], [1, 'Deload', 'deload']] as const) {
        await pool.query(`INSERT INTO program_phases (phase_set_id, position, name, duration_cycles, phase_type) VALUES ($1,$2,$3,2,$4)`, [id, pos, `${n} ${user.slice(-2)}`, type])
      }
      return id
    }
    const aSet = await set(A, 'A set'); const bSet = await set(B, 'B set')
    program = (await pool.query(`INSERT INTO programs (user_id, name, phase_mode, phase_set_id, started_at, cycle_anchor_at) VALUES ($1,'P','automatic',$2,'2026-10-01', now() - interval '20 days') RETURNING id`, [A, aSet])).rows[0].id
    plain = (await pool.query(`INSERT INTO programs (user_id, name, phase_mode) VALUES ($1,'Plain','manual') RETURNING id`, [A])).rows[0].id
    // A's program pointing at B's phase set: the old read resolved it to no phases.
    foreign = (await pool.query(`INSERT INTO programs (user_id, name, phase_mode, phase_set_id) VALUES ($1,'Foreign','automatic',$2) RETURNING id`, [A, bSet])).rows[0].id
    push = (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Push',0) RETURNING id`, [program])).rows[0].id
    pull = (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Pull',1) RETURNING id`, [program])).rows[0].id
    await pool.query(`INSERT INTO program_sessions (program_id, name, position, deleted_at) VALUES ($1,'Gone',2, now())`, [program])
    const log = (sid: string | null, name: string, days: number, o: { early?: boolean; deleted?: boolean; user?: string } = {}) =>
      pool.query(`INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, is_early_deload, deleted_at) VALUES ($1,$2,$3, now() - ($4 || ' days')::interval, $5, $6)`,
        [o.user ?? A, sid, name, String(days), o.early ?? false, o.deleted ? new Date() : null])
    await log(push, 'Push', 2); await log(push, 'Push', 3); await log(pull, 'Pull', 4)
    await log(null, 'PUSH', 5)                         // legacy row: matched to Push by name, case-blind
    await log(null, 'Renamed away', 5)                 // matches no current session: left out
    await log(push, 'Push', 6, { early: true })        // early deload: not counted
    await log(push, 'Push', 7, { deleted: true })      // deleted: not counted
    await log(push, 'Push', 40)                        // before the cycle anchor: not counted
    await log(push, 'Push', 2, { user: B })            // another user's row: not counted
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[A, B]])
  })

  const both = async (u: string, p: string) => ({
    phases: await slice.listProgramPhases(db, u, p),
    sessionCounts: await slice.countAllSessionsSinceStart(db, u, p),
  })

  it('returns the same phases, in position order, and the same counts', async () => {
    const one = await slice.getProgramPhaseState(db, A, program)
    const two = await both(A, program)
    expect(one.phases).toEqual(two.phases)
    expect(one.phases.map(p => p.position)).toEqual([0, 1, 2])
    expect(one.sessionCounts).toEqual(two.sessionCounts)
    expect([...one.sessionCounts]).toEqual(expect.arrayContaining([[push, 3], [pull, 1]]))
    expect(one.sessionCounts.size).toBe(2)
  })

  it('a program with no phase set has no phases (and nothing to count)', async () => {
    const one = await slice.getProgramPhaseState(db, A, plain)
    expect(one.phases).toEqual([])
    expect(one.phases).toEqual(await slice.listProgramPhases(db, A, plain))
    expect(one.sessionCounts.size).toBe(0)
  })

  it('a phase set that is not the caller\'s resolves to nothing, and so does a program that is not', async () => {
    expect((await slice.getProgramPhaseState(db, A, foreign)).phases).toEqual([])
    expect(await slice.listProgramPhases(db, A, foreign)).toEqual([])
    expect((await slice.getProgramPhaseState(db, B, program)).phases).toEqual([])
    expect((await slice.getProgramPhaseState(db, A, '00000000-0000-4000-8000-000000000000')).phases).toEqual([])
  })

  it('is one statement, and takes no lock', async () => {
    const pg = await import('pg')
    const { vi } = await import('vitest')
    const spy = vi.spyOn(pg.Client.prototype, 'query')
    try {
      await slice.getProgramPhaseState(db, A, program)
      const sent = spy.mock.calls.map(c => (typeof c[0] === 'string' ? c[0] : (c[0] as { text: string }).text))
      expect(sent).toHaveLength(1)
      expect(sent[0]).not.toMatch(/for\s+(update|share|no key)|pg_advisory|lock/i)
    } finally { spy.mockRestore() }
  })
})
