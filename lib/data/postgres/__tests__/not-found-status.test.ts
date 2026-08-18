import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// Q-463. The measurement, turned into a test: every write route with a dynamic segment, called as an
// AUTHENTICATED user with a fabricated UUID. Five answered 500 — four with an empty body — because
// the repository threw a bare `Error('… not found')` and nothing mapped it.
//
// The `phase-sets` pair is the sharpest case: the SAME resource, SAME condition and SAME message got
// `400` from PUT and `500` from DELETE. Neither was 404.
//
// Runs only against a real local dev Postgres — skips in CI.
const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000000463'
const FAKE = '00000000-0000-4000-8000-0000000fffff'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

const params = Promise.resolve({ id: FAKE })
const req = (body?: object) => new Request('http://localhost/x', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
}) as never

describe.skipIf(!canRun)('a fabricated id is 404 with a JSON body, not 500', () => {
  let pool: import('pg').Pool

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1,$2,'x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [USER, `notfound-${USER}@example.com`])
  })
  afterAll(async () => { await pool.query(`DELETE FROM users WHERE id=$1`, [USER]) })

  // The five that answered 500. Each asserts BOTH halves of the defect: the status, and that the
  // body parses at all — four of them returned nothing, so a client's res.json() threw.
  const cases: Array<[string, () => Promise<Response>, string]> = [
    ['PATCH /api/injuries/[id]', async () => {
      const { PATCH } = await import('@/app/api/injuries/[id]/route')
      return PATCH(req({ notes: 'x' }) as never, { params })
    }, 'Injury not found'],
    ['PUT /api/nutrition/meal-types/[id]', async () => {
      const { PUT } = await import('@/app/api/nutrition/meal-types/[id]/route')
      return PUT(req({ name: 'Probe' }) as never, { params })
    }, 'Meal type not found'],
    ['PATCH /api/supplements/[id]', async () => {
      const { PATCH } = await import('@/app/api/supplements/[id]/route')
      return PATCH(req({ name: 'x' }) as never, { params })
    }, 'Supplement not found'],
    ['POST /api/supplements/[id]/log', async () => {
      const { POST } = await import('@/app/api/supplements/[id]/log/route')
      return POST(req() as never, { params })
    }, 'Supplement not found'],
    ['DELETE /api/phase-sets/[id]', async () => {
      const { DELETE } = await import('@/app/api/phase-sets/[id]/route')
      return DELETE(req() as never, { params })
    }, 'Phase set not found'],
  ]

  for (const [name, call, message] of cases) {
    it(`${name} → 404 { error }`, async () => {
      const res = await call()
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: message })
    })
  }

  // One resource, two verbs, two different wrong answers — 400 from PUT and 500 from DELETE for the
  // identical condition. They must agree now.
  it('phase-sets PUT and DELETE agree on the same condition', async () => {
    const { PUT, DELETE } = await import('@/app/api/phase-sets/[id]/route')
    const put = await PUT(req({ name: 'x', phases: [] }) as never, { params })
    const del = await DELETE(req() as never, { params })
    expect(put.status).toBe(404)
    expect(del.status).toBe(404)
    expect(await put.json()).toEqual(await del.json())
  })

  // The entry is explicit that this looks like the same shape and is NOT: DELETE is idempotent by
  // convention, the desired end state (row absent) holds, and the outbox is right to treat it as
  // done. Pinned so it does not get "fixed" later.
  it('leaves an idempotent DELETE of an absent row at 200', async () => {
    const { DELETE } = await import('@/app/api/nutrition/meal-types/[id]/route')
    const res = await DELETE(req() as never, { params })
    expect(res.status).toBe(200)
  })
})
