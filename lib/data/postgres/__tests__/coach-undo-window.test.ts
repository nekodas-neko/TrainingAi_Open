// The undo window: **until your next workout, not a clock** (owner decision).
//
// This rule lives in `app/api/coach/apply/[id]/undo/route.ts` as an inline query and nowhere else —
// the engine's own suite (`coach-apply.test.ts`) cannot see it, and the route-level file
// (`lib/__tests__/coach-lifecycle-routes.test.ts`) answers that query with a stub, so it pins which
// branch each result takes rather than which rows the predicate selects. Both halves are needed and
// this is the half that needs real rows: `startedAt > appliedAt`, scoped to the caller.
//
// A time-based window would be arbitrary — an hour is too short if you applied it at night and too
// long if you trained ten minutes later. What matters is whether the change has already shaped a
// session you have done, which is why the fixtures below differ only in WHEN the workout started.
//
// Runs only against a real local dev Postgres — skips in CI, like its siblings here.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const OWNER = '00000000-0000-4000-8000-0000000000d1'
const STRANGER = '00000000-0000-4000-8000-0000000000d2'
const CHANGE = '00000000-0000-4000-8000-0000000000d3'
const APPLIED_AT = new Date('2026-09-01T03:00:00Z')

let sessionUser: { id: string; timezone?: string } | null = { id: OWNER, timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))

describe.skipIf(!canRun)('AI Coach — the undo window closes when you train', () => {
  let pool: import('pg').Pool
  let POST: typeof import('@/app/api/coach/apply/[id]/undo/route').POST

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    ;({ POST } = await import('@/app/api/coach/apply/[id]/undo/route'))

    // Email derived FROM the id, not hardcoded beside it: changing the id later would otherwise
    // leave a stale email behind and fail `users_email_unique` under the new one.
    for (const id of [OWNER, STRANGER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `coach-undo-${id}@example.com`])
    }
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[OWNER, STRANGER]])
    await pool.query(`DELETE FROM coach_changes WHERE user_id = ANY($1)`, [[OWNER, STRANGER]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[OWNER, STRANGER]])
  })

  beforeEach(async () => {
    sessionUser = { id: OWNER, timezone: 'Australia/Brisbane' }
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[OWNER, STRANGER]])
    await pool.query(`DELETE FROM coach_changes WHERE user_id = ANY($1)`, [[OWNER, STRANGER]])
    await pool.query(
      `INSERT INTO coach_changes (id, user_id, domain, target_id, patch, accepted_ids, applied_at)
       VALUES ($1, $2, 'user_goals', $1, '{}'::jsonb, ARRAY['c1'], $3)`,
      [CHANGE, OWNER, APPLIED_AT])
  })

  const trainedAt = (userId: string, at: Date) =>
    pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1, 'Lower', $2)`,
      [userId, at])

  const undo = () =>
    POST(new Request(`http://localhost/api/coach/apply/${CHANGE}/undo`, { method: 'POST' }),
      { params: Promise.resolve({ id: CHANGE }) })

  const hours = (n: number) => new Date(APPLIED_AT.getTime() + n * 3_600_000)

  it('refuses the undo once a workout has started since the change', async () => {
    await trainedAt(OWNER, hours(2))
    const res = await undo()

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain("trained since this change")
  })

  // The half a stub cannot check: the comparison is against the change's OWN applied_at, so a
  // session that started BEFORE it leaves the window open however recent it is.
  it('leaves the window open for a workout that started before the change', async () => {
    await trainedAt(OWNER, hours(-2))
    const res = await undo()

    expect(res.status).not.toBe(409)
    expect((await res.json()).error ?? '').not.toContain('trained since this change')
  })

  // The other half a stub cannot check: the predicate is user-scoped, so someone else training
  // must not close this caller's window.
  it("is not closed by another user's workout after the change", async () => {
    await trainedAt(STRANGER, hours(2))
    const res = await undo()

    expect(res.status).not.toBe(409)
    expect((await res.json()).error ?? '').not.toContain('trained since this change')
  })

  it('answers 404 for a change belonging to someone else', async () => {
    sessionUser = { id: STRANGER, timezone: 'Australia/Brisbane' }
    expect((await undo()).status).toBe(404)
  })
})
