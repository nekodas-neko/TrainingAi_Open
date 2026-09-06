import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// RV-47 and RV-48, together, because they are two halves of one question: does the answer a
// body-supplied id gets mean what it says?
//
// RV-47 — `invalidUuidResponse` was applied to 27 of 27 dynamic `[id]` routes and zero body-id
// ones, so a malformed id reached the driver, raised `22P02`, and answered 500 — two of them with
// an empty body, which makes a client's `res.json()` throw on top of the failure. The self-control
// is what makes it a defect rather than a preference: the same route, the same payload, one field
// differing only in *format*, answering 500 for the malformed one and 404 for the missing one.
//
// RV-48 — an update that matched no row answered `200 {"ok":true}`, the same response a real write
// gives. This is RV-45's delete finding on the update surface, with a different cause: the deletes
// discarded an affected-row count they could have returned, these never asked for one.
//
// Two ids are NOT interchangeable here and the split is the point:
//   ABSENT_ID  — well-formed, belongs to nobody. Exercises the not-found path (RV-48).
//   MALFORMED  — not a uuid at all. Never reaches the handler's query (RV-47).
// Asserting 404 with a malformed id would pass on a route with no not-found path at all, because
// the guard answers first.
const USER = '00000000-0000-4000-8000-0000000047aa'
const ABSENT_ID = '00000000-0000-4000-8000-0000deadbeef'
const MALFORMED = 'not-a-uuid'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER, timezone: 'Australia/Brisbane', isAdmin: true } })),
}))

const canRun = !!process.env.DATABASE_URL

function req(method: string, body: unknown, url = 'http://localhost/x') {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const VALID_EXERCISE = {
  name: 'RV-47 probe', equipment: [], muscles: [],
  instructions: 'x', exerciseType: 'weighted' as const,
}

describe.skipIf(!canRun)('a body-supplied id gets an answer that means what it says', () => {
  let pool: import('pg').Pool

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    // `requireAdmin` reads `is_admin` out of the database rather than trusting the session claim,
    // so the mocked `isAdmin: true` above is not enough on its own for the two admin routes.
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin)
       VALUES ($1, $2, 'x', 'Australia/Brisbane', true) ON CONFLICT (id) DO NOTHING`,
      [USER, `rv47-${USER}@example.com`])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM meal_types WHERE user_id = $1', [USER])
    await pool.query('DELETE FROM users WHERE id = $1', [USER])
  })

  // ── RV-47: a malformed id is a malformed request, not a server fault ────────────────────────
  describe('a malformed id answers 400 before any query runs (RV-47)', () => {
    it('PATCH /api/admin/exercises', async () => {
      const { PATCH } = await import('@/app/api/admin/exercises/route')
      const res = await PATCH(req('PATCH', { id: MALFORMED, ...VALID_EXERCISE }) as never)
      expect(res.status).toBe(400)
    })

    it('PATCH /api/admin/users', async () => {
      const { PATCH } = await import('@/app/api/admin/users/route')
      const res = await PATCH(req('PATCH', { userId: MALFORMED, action: 'deactivate' }) as never)
      expect(res.status).toBe(400)
    })

    it('DELETE /api/admin/users', async () => {
      const { DELETE } = await import('@/app/api/admin/users/route')
      const res = await DELETE(req('DELETE', { userId: MALFORMED }) as never)
      expect(res.status).toBe(400)
    })

    it('PATCH /api/nutrition/meal-types — one bad entry fails the whole array', async () => {
      const { PATCH } = await import('@/app/api/nutrition/meal-types/route')
      const res = await PATCH(req('PATCH', { orderedIds: [ABSENT_ID, MALFORMED] }))
      expect(res.status).toBe(400)
    })

    it('DELETE /api/workout-entry — PATCH had `.uuid()`, DELETE parsed the body by hand', async () => {
      const { DELETE } = await import('@/app/api/workout-entry/route')
      const res = await DELETE(req('DELETE', { exerciseLogId: MALFORMED }) as never)
      expect(res.status).toBe(400)
    })

    // The half that makes the four above a finding rather than a style choice: on this route the
    // two ids are each other's control, and before RV-47 they answered 500 and 404.
    it('the same route answers 404 — not 500 — for a well-formed id that does not exist', async () => {
      const { PATCH } = await import('@/app/api/admin/exercises/route')
      const res = await PATCH(req('PATCH', { id: ABSENT_ID, ...VALID_EXERCISE }) as never)
      expect(res.status).toBe(404)
    })
  })

  // ── RV-48: nothing matched is not success ──────────────────────────────────────────────────
  describe('an update that matched nothing answers 404 (RV-48)', () => {
    it('PATCH /api/admin/users', async () => {
      const { PATCH } = await import('@/app/api/admin/users/route')
      const res = await PATCH(req('PATCH', { userId: ABSENT_ID, action: 'deactivate' }) as never)
      expect(res.status).toBe(404)
    })

    it('DELETE /api/admin/users', async () => {
      const { DELETE } = await import('@/app/api/admin/users/route')
      const res = await DELETE(req('DELETE', { userId: ABSENT_ID }) as never)
      expect(res.status).toBe(404)
    })

    it('PATCH /api/oura/workouts — a `text` key, so nothing could ever fail loudly here', async () => {
      const { PATCH } = await import('@/app/api/oura/workouts/route')
      const res = await PATCH(req('PATCH', { id: 'no-such-oura-workout' }) as never)
      expect(res.status).toBe(404)
    })

    it('DELETE /api/admin/exercises — deletes by name, so a misspelling removed nothing', async () => {
      const { DELETE } = await import('@/app/api/admin/exercises/route')
      const res = await DELETE(req('DELETE', {}, 'http://localhost/x?name=no-such-exercise-rv48') as never)
      expect(res.status).toBe(404)
    })
  })

  // ── The reorder, which is the one route whose *behaviour* changed, not just its status ──────
  describe('the meal-type reorder applies all of the ids or none of them', () => {
    async function seedThree() {
      await pool.query('DELETE FROM meal_types WHERE user_id = $1', [USER])
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO meal_types (user_id, name, emoji, sort_order, time_start_hour, time_end_hour)
         VALUES ($1,'A','🍳',0,6,10), ($1,'B','🥗',1,12,15), ($1,'C','🍽️',2,17,21)
         RETURNING id`, [USER])
      return rows.map(r => r.id)
    }
    const orderOf = async () => (await pool.query<{ name: string }>(
      'SELECT name FROM meal_types WHERE user_id = $1 ORDER BY sort_order', [USER])).rows.map(r => r.name)

    it('a real reorder still applies — the positive control', async () => {
      const [a, b, c] = await seedThree()
      const { PATCH } = await import('@/app/api/nutrition/meal-types/route')
      const res = await PATCH(req('PATCH', { orderedIds: [c, a, b] }))
      expect(res.status).toBe(200)
      expect(await orderOf()).toEqual(['C', 'A', 'B'])
    })

    // Without this the 404 above proves nothing: a route that refuses everything also refuses a
    // ghost id. This is the case where the old code committed a partial order and called it a
    // success.
    it('one stale id leaves the stored order completely untouched', async () => {
      const [a, b, c] = await seedThree()
      const { PATCH } = await import('@/app/api/nutrition/meal-types/route')
      const res = await PATCH(req('PATCH', { orderedIds: [c, ABSENT_ID, a, b] }))
      expect(res.status).toBe(404)
      expect(await orderOf()).toEqual(['A', 'B', 'C'])
    })
  })
})
