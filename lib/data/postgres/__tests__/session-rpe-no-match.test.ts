import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// Q-460. `setSessionRpe` is user-scoped, which is correct — a cross-account call changes nothing.
// The defect was that **both callers treated "matched nothing" as success**, measured live three
// ways: user B posting to user A's real session got `200 {"success":true}` with A's `session_rpe`
// still NULL, and a fabricated UUID got the same.
//
// On device it is worse than a wrong status code: `pushMutations` did `processed++`
// unconditionally, so a mutation whose session row is absent server-side was counted as processed
// and removed from the outbox. Local kept the RPE, the server never got it, nothing retried.
//
// Runs only against a real local dev Postgres — skips in CI.
const canRun = !!process.env.DATABASE_URL

const USER_A = '00000000-0000-4000-8000-000000000460'
const USER_B = '00000000-0000-4000-8000-000000000461'
const MISSING_SESSION = '00000000-0000-4000-8000-0000deadbeef'

let currentUser = USER_A
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: currentUser, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

const jsonReq = (body: object) => new Request('http://localhost/api/workout-sessions/rpe', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}) as never

describe.skipIf(!canRun)('session RPE — a write that matched nothing is not a success', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let sessionA = ''

  const rpeOf = async (id: string) => (await pool.query(
    `SELECT session_rpe FROM workout_sessions WHERE id = $1`, [id])).rows[0]?.session_rpe ?? null

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool(); repo = await getRepository()
    for (const id of [USER_A, USER_B]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone)
         VALUES ($1,$2,'x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
        [id, `rpe-${id.slice(-4)}@example.com`])
    }
  })
  beforeEach(async () => {
    currentUser = USER_A
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[USER_A, USER_B]])
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at)
       VALUES ($1, 'RPE Session', now()) RETURNING id`, [USER_A])
    sessionA = ws.id
  })
  afterAll(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[USER_A, USER_B]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER_A, USER_B]])
  })

  describe('the adapter reports whether anything was written', () => {
    it('writes and reports true for the owner', async () => {
      expect(await repo.setSessionRpe(USER_A, sessionA, 8)).toBe(true)
      expect(await rpeOf(sessionA)).toBe(8)
    })

    // The security half is correct and must stay correct: the cross-account call changes nothing.
    // What changes is that it now SAYS so.
    it('reports false for another user’s session, and leaves it untouched', async () => {
      expect(await repo.setSessionRpe(USER_B, sessionA, 9)).toBe(false)
      expect(await rpeOf(sessionA)).toBeNull()
    })

    it('reports false for a session id that does not exist', async () => {
      expect(await repo.setSessionRpe(USER_A, MISSING_SESSION, 7)).toBe(false)
    })
  })

  describe('the route', () => {
    it('200s for the owner', async () => {
      const { POST } = await import('@/app/api/workout-sessions/rpe/route')
      const res = await POST(jsonReq({ workoutSessionId: sessionA, sessionRpe: 8 }))
      expect(res.status).toBe(200)
      expect(await rpeOf(sessionA)).toBe(8)
    })

    it('404s across accounts instead of reporting success', async () => {
      currentUser = USER_B
      const { POST } = await import('@/app/api/workout-sessions/rpe/route')
      const res = await POST(jsonReq({ workoutSessionId: sessionA, sessionRpe: 9 }))
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Workout session not found' })
      expect(await rpeOf(sessionA)).toBeNull()
    })

    it('404s for a fabricated session id', async () => {
      const { POST } = await import('@/app/api/workout-sessions/rpe/route')
      expect((await POST(jsonReq({ workoutSessionId: MISSING_SESSION, sessionRpe: 7 }))).status).toBe(404)
    })
  })

  // The half that loses data. `errors` is not a quarantine — the client retries a failed mutation
  // with backoff and dead-letters it after MAX_MUTATION_ATTEMPTS — so the common transient case (the
  // RPE pushed before the session that carries it) still lands, and a genuinely orphaned one is
  // visible instead of gone.
  describe('the outbox push', () => {
    const mut = (workoutSessionId: string) => ([{
      id: 'mut-460', domain: 'session_rpe', date: '2026-08-18',
      payload: { workoutSessionId, sessionRpe: 6 },
    }] as never)

    it('counts a real write as processed', async () => {
      const r = await repo.pushMutations(USER_A, mut(sessionA))
      expect(r.processed).toBe(1)
      expect(r.errors).toEqual([])
      expect(await rpeOf(sessionA)).toBe(6)
    })

    it('does NOT count a write that matched nothing, and reports it', async () => {
      const r = await repo.pushMutations(USER_A, mut(MISSING_SESSION))
      expect(r.processed).toBe(0)
      expect(r.errors).toHaveLength(1)
      expect(r.errors[0]).toMatchObject({ id: 'mut-460', domain: 'session_rpe' })
      expect(r.errors[0].error).toMatch(/No matching workout session/)
    })

    it('does not let one orphaned RPE strand a valid sibling behind it', async () => {
      const r = await repo.pushMutations(USER_A, ([
        { id: 'mut-bad', domain: 'session_rpe', date: '2026-08-18', payload: { workoutSessionId: MISSING_SESSION, sessionRpe: 5 } },
        { id: 'mut-good', domain: 'session_rpe', date: '2026-08-18', payload: { workoutSessionId: sessionA, sessionRpe: 9 } },
      ] as never))
      expect(r.processed).toBe(1)
      expect(r.errors.map(e => e.id)).toEqual(['mut-bad'])
      expect(await rpeOf(sessionA)).toBe(9)
    })
  })

  // The entry's explicit warning: do not "fix" the neighbour by copying this. Zero rows there is the
  // expected idempotent outcome, because the UPDATE carries isNull(warmupEndedAt).
  it('leaves setWorkoutSessionWarmupEnd’s zero-row case silent — there it means "already set"', async () => {
    const first = new Date()
    await repo.setWorkoutSessionWarmupEnd(USER_A, sessionA, first)
    const { rows: [a] } = await pool.query(`SELECT warmup_ended_at FROM workout_sessions WHERE id = $1`, [sessionA])
    expect(a.warmup_ended_at).not.toBeNull()

    // Second call matches zero rows and must neither throw nor overwrite.
    await expect(repo.setWorkoutSessionWarmupEnd(USER_A, sessionA, new Date(Date.now() + 60_000))).resolves.toBeUndefined()
    const { rows: [b] } = await pool.query(`SELECT warmup_ended_at FROM workout_sessions WHERE id = $1`, [sessionA])
    expect(new Date(b.warmup_ended_at).getTime()).toBe(new Date(a.warmup_ended_at).getTime())
  })
})
