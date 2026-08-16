// Q-129: `programs.phase_set_id` is a client-writable FK into a strictly user-scoped table, and
// three links in the chain trusted it — the workout-templates write took any id, listProgramPhases
// resolved it with no user scope (rendering a stranger's phase names/types/durations on this user's
// workout screen), and deletePhaseSet's in-use probe was unscoped too, so a stranger's program both
// blocked the delete and had its name echoed back in the error.
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else (CI's "Tests" job has
// no DATABASE_URL) so CI stays green.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const USER_A = '00000000-0000-4000-8000-0000000ba5e1'
const USER_B = '00000000-0000-4000-8000-0000000ba5e2'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER_A, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

describe.skipIf(!canRun)('phase-set ownership (Q-129)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let bPhaseSetId: string
  let bProgramId: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    for (const [id, tag] of [[USER_A, 'a'], [USER_B, 'b']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`,
        [id, `phase-set-ownership-${tag}@example.com`],
      )
    }

    // User B: a phase set with one phase, and a program using it.
    const ps = await pool.query(
      `INSERT INTO phase_sets (user_id, name) VALUES ($1, 'B Secret Blocks') RETURNING id`, [USER_B])
    bPhaseSetId = ps.rows[0].id
    await pool.query(
      `INSERT INTO program_phases (phase_set_id, position, name, duration_cycles, phase_type)
       VALUES ($1, 0, 'B Secret Accumulation', 4, 'normal')`, [bPhaseSetId])
    const prog = await pool.query(
      `INSERT INTO programs (user_id, name, is_active, phase_mode, phase_set_id)
       VALUES ($1, 'B Secret Program', false, 'automatic', $2) RETURNING id`, [USER_B, bPhaseSetId])
    bProgramId = prog.rows[0].id
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [USER_A, USER_B]) {
      await pool.query(`DELETE FROM programs WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM phase_sets WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  it('listProgramPhases returns nothing for a program the caller does not own', async () => {
    expect(await repo.listProgramPhases(USER_B, bProgramId)).toHaveLength(1)
    expect(await repo.listProgramPhases(USER_A, bProgramId)).toEqual([])
  })

  it('POST /api/workout-templates rejects a phaseSetId belonging to another user', async () => {
    const { POST } = await import('@/app/api/workout-templates/route')
    const res = await POST(new Request('http://localhost/api/workout-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        program: { name: 'A Program', isActive: false, sessions: [], phaseMode: 'automatic', phaseSetId: bPhaseSetId },
      }),
    }) as never)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid phaseSetId')
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM programs WHERE user_id = $1 AND phase_set_id = $2`, [USER_A, bPhaseSetId])
    expect(rows[0].n).toBe(0)
  })

  it("deletePhaseSet's in-use probe ignores another user's program", async () => {
    // A's own set, referenced only by B's program (the leak's shape: an id B mounted, or a stale
    // cross-user reference). The delete must succeed and must not name B's program.
    const ps = await pool.query(
      `INSERT INTO phase_sets (user_id, name) VALUES ($1, 'A Blocks') RETURNING id`, [USER_A])
    const aPhaseSetId = ps.rows[0].id
    await pool.query(`UPDATE programs SET phase_set_id = $1 WHERE id = $2`, [aPhaseSetId, bProgramId])

    await expect(repo.deletePhaseSet(aPhaseSetId, USER_A)).resolves.toBeUndefined()

    await pool.query(`UPDATE programs SET phase_set_id = $1 WHERE id = $2`, [bPhaseSetId, bProgramId])
  })
})
