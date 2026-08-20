// RV-32 / RV-34 — the program-config write surface, and the client-supplied FKs it trusted.
//
// RV-32: `progression_styles.user_id` is NOT NULL and there is no shared or global style, so a style
// id the caller does not own is always wrong. `PUT /api/phase-sets/[id]` refused one; the create
// twin, `POST /api/workout-templates` and the shared log-exercise path did not. All three FKs are
// `ON DELETE SET NULL`, so the owner deleting their own style nulled a column in the borrower's rows.
//
// RV-34: `saveProgram` uses the client's `sessions[].id` as the new row's primary key — deliberately,
// so an edit does not sever already-logged workouts. An id belonging to another user's program was a
// raw `23505` 500 with the failed SQL in `error_events`.
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else (CI's "Tests" job has
// no DATABASE_URL) so CI stays green.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const USER_A = '00000000-0000-4000-8000-0000000fc0a1'
const USER_B = '00000000-0000-4000-8000-0000000fc0a2'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER_A, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

describe.skipIf(!canRun)('program-config write FKs (RV-32, RV-34)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let bStyleId: string
  let aStyleId: string
  let bSessionId: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    for (const [id, tag] of [[USER_A, 'a'], [USER_B, 'b']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`,
        [id, `program-write-fk-${tag}@example.com`],
      )
    }

    const bStyle = await pool.query(
      `INSERT INTO progression_styles (user_id, name) VALUES ($1, 'B Secret Ramp') RETURNING id`, [USER_B])
    bStyleId = bStyle.rows[0].id
    const aStyle = await pool.query(
      `INSERT INTO progression_styles (user_id, name) VALUES ($1, 'A Ramp') RETURNING id`, [USER_A])
    aStyleId = aStyle.rows[0].id

    const bProg = await pool.query(
      `INSERT INTO programs (user_id, name, is_active) VALUES ($1, 'B Secret Program', false) RETURNING id`, [USER_B])
    const bSess = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'B Session', 0) RETURNING id`,
      [bProg.rows[0].id])
    bSessionId = bSess.rows[0].id
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [USER_A, USER_B]) {
      await pool.query(`DELETE FROM programs WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM phase_sets WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM progression_styles WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  // Guards the file: if the fixture stopped creating B's style, every "rejects B's id" case below
  // would pass by rejecting a nonexistent one.
  it('the fixture really does give each user a style the other does not own', async () => {
    expect(await repo.progressionStyleIdsOwned(USER_B, [bStyleId])).toBe(true)
    expect(await repo.progressionStyleIdsOwned(USER_A, [bStyleId])).toBe(false)
    expect(await repo.progressionStyleIdsOwned(USER_A, [aStyleId])).toBe(true)
  })

  it('treats a malformed id as unowned rather than letting 22P02 reach the driver', async () => {
    await expect(repo.progressionStyleIdsOwned(USER_A, ['not-a-uuid'])).resolves.toBe(false)
  })

  it('an empty or all-null list is owned — the guard must not refuse a program with no styles', async () => {
    expect(await repo.progressionStyleIdsOwned(USER_A, [])).toBe(true)
    expect(await repo.progressionStyleIdsOwned(USER_A, [null, undefined])).toBe(true)
  })

  it('POST /api/phase-sets rejects a style id belonging to another user (RV-32)', async () => {
    const { POST } = await import('@/app/api/phase-sets/route')
    const res = await POST(new Request('http://localhost/api/phase-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'A Blocks',
        phases: [{ name: 'Accumulation', durationCycles: 4, phaseType: 'normal', primaryStyleId: bStyleId }],
      }),
    }) as never)

    expect(res.status).toBe(400)
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM program_phases WHERE primary_style_id = $1`, [bStyleId])
    expect(rows[0].n).toBe(0)
  })

  it('POST /api/phase-sets still accepts the caller\'s own style id', async () => {
    const { POST } = await import('@/app/api/phase-sets/route')
    const res = await POST(new Request('http://localhost/api/phase-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'A Blocks Own',
        phases: [{ name: 'Accumulation', durationCycles: 4, phaseType: 'normal', primaryStyleId: aStyleId }],
      }),
    }) as never)
    expect(res.status).toBe(200)
  })

  it('POST /api/workout-templates rejects a session exercise styleId belonging to another user (RV-32)', async () => {
    const { POST } = await import('@/app/api/workout-templates/route')
    const res = await POST(new Request('http://localhost/api/workout-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        program: {
          name: 'A Borrowed Style', isActive: false,
          sessions: [{
            name: 'Push', position: 0,
            exercises: [{ exerciseName: 'Bench', position: 0, muscleGroups: ['chest'], styleId: bStyleId }],
          }],
        },
      }),
    }) as never)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid styleId')
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM session_exercises WHERE style_id = $1`, [bStyleId])
    expect(rows[0].n).toBe(0)
  })

  it('listPhaseSets does not hand back another user\'s style NAME (RV-32)', async () => {
    // The leak's shape: a phase row already pointing at B's style, as the unguarded write paths
    // allowed. The join must render it blank for A rather than echoing B's words — this is what
    // stays true for rows written before the write guards existed.
    const ps = await pool.query(
      `INSERT INTO phase_sets (user_id, name) VALUES ($1, 'A Stale') RETURNING id`, [USER_A])
    await pool.query(
      `INSERT INTO program_phases (phase_set_id, position, name, duration_cycles, phase_type, primary_style_id)
       VALUES ($1, 0, 'Accumulation', 4, 'normal', $2)`, [ps.rows[0].id, bStyleId])

    const sets = await repo.listPhaseSets(USER_A)
    const stale = sets.find(x => x.id === ps.rows[0].id)!
    expect(stale.phases[0].primaryStyleId).toBe(bStyleId)   // the reference itself is untouched
    expect(stale.phases[0].primaryStyleName ?? null).toBeNull()
  })

  it('saveProgram refuses a program_sessions.id owned by another program (RV-34)', async () => {
    await expect(repo.saveProgram(USER_A, {
      id: '', userId: USER_A, name: 'A Stealing A Session', isActive: false,
      createdAt: new Date(), updatedAt: new Date(),
      sessions: [{ id: bSessionId, name: 'Push', position: 0, exercises: [] }],
    } as never)).rejects.toThrow(/another program/i)

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM programs WHERE user_id = $1 AND name = 'A Stealing A Session'`, [USER_A])
    expect(rows[0].n).toBe(0)
  })

  it('saveProgram still accepts brand-new client-minted session ids (the builder\'s shape)', async () => {
    // `builder-review.tsx` mints a fresh crypto.randomUUID() for EVERY session on save, so a guard
    // reading "must be one of this program's existing rows" would refuse every build. This is the
    // case that makes the guard "exists under a different program" instead.
    const fresh = crypto.randomUUID()
    const saved = await repo.saveProgram(USER_A, {
      id: '', userId: USER_A, name: 'A Fresh Ids', isActive: false,
      createdAt: new Date(), updatedAt: new Date(),
      sessions: [{ id: fresh, name: 'Push', position: 0, exercises: [] }],
    } as never)
    expect(saved.sessions[0].id).toBe(fresh)
  })

  it('saveProgram refuses a malformed session id instead of 22P02-ing at the driver', async () => {
    await expect(repo.saveProgram(USER_A, {
      id: '', userId: USER_A, name: 'A Malformed Id', isActive: false,
      createdAt: new Date(), updatedAt: new Date(),
      sessions: [{ id: 'not-a-uuid', name: 'Push', position: 0, exercises: [] }],
    } as never)).rejects.toThrow(/malformed/i)
  })
})
