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

  // ⚠ THIS ASSERTION WAS REVERSED, 2026-09-05 (RV-45). It used to require 200 and said "pinned so it
  // does not get 'fixed' later" — the pin worked, and this is the cause it was asking for rather
  // than a later session quietly flipping it.
  //
  // The 2026-08-18 argument was that DELETE is idempotent by convention and the desired end state
  // (row absent) genuinely holds. **That premise is true for the owner re-deleting their own row and
  // false across accounts**, where the row is present and correctly so — ownership is enforced, and
  // reporting a correct refusal as a success is what makes it invisible. Measured in the RV-45
  // sweep: a second account deleted the first's supplement, got `200 {"ok":true}`, and the row was
  // still in Postgres with its owner unchanged.
  //
  // It also is not only cosmetic. `manage-supplements-sheet.tsx` and `injury-sheet.tsx` both do
  // `if (!res.ok) throw`, then drop the row and toast "deleted" — so a delete that removed nothing
  // confirms itself and the row returns on the next pull.
  //
  // Q-556 reached this conclusion first and shipped 404 on `activity-logs`, leaving that route the
  // only one of seven doing so. This aligns the rest rather than inventing a new answer.
  it('404s a DELETE of an absent row, so a no-op is not reported as a success (RV-45)', async () => {
    const { DELETE } = await import('@/app/api/nutrition/meal-types/[id]/route')
    const res = await DELETE(req() as never, { params })
    expect(res.status).toBe(404)
  })
})
