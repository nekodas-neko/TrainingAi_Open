import { describe, it, expect, vi } from 'vitest'

// RV-45. Seven delete routes answered 200 to a delete that matched no row — including a correctly
// refused cross-account one, which made an enforced ownership check indistinguishable from a
// success and kept it out of `error_events` entirely. Q-556 had already shipped 404 on
// `activity-logs`, leaving that route the only one of seven doing so.
//
// The failure this guards is divergence, not any single route: a sweep that aligns seven surfaces
// and pins none of them diverges again the next time one is touched. So the table below is the
// assertion — a new delete route added without a 404 branch shows up here as a missing entry rather
// than as nothing at all.
const TEST_USER = '00000000-0000-4000-8000-0000000045aa'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER, timezone: 'Australia/Brisbane', isAdmin: true } })),
}))

// A syntactically valid uuid that belongs to nobody. Deliberately not a malformed one: those are
// rejected by the id guard at 400 before the handler runs, which proves nothing about this.
const ABSENT_ID = '00000000-0000-4000-8000-0000deadbeef'

const ROUTES: { name: string; mod: string; usesQueryId?: boolean }[] = [
  { name: 'supplements/[id]',            mod: '@/app/api/supplements/[id]/route' },
  { name: 'supplements/[id]/log',        mod: '@/app/api/supplements/[id]/log/route' },
  { name: 'injuries/[id]',               mod: '@/app/api/injuries/[id]/route' },
  { name: 'nutrition/food-logs/[id]',    mod: '@/app/api/nutrition/food-logs/[id]/route' },
  { name: 'nutrition/saved-meals/[id]',  mod: '@/app/api/nutrition/saved-meals/[id]/route' },
  { name: 'nutrition/meal-types/[id]',   mod: '@/app/api/nutrition/meal-types/[id]/route' },
  { name: 'activity-logs (Q-556, the reference the rest were aligned to)', mod: '@/app/api/activity-logs/route' },
]

const canRun = !!process.env.DATABASE_URL

describe.skipIf(!canRun)('a delete that matched nothing answers 404, on every sibling (RV-45)', () => {
  for (const route of ROUTES) {
    it(`${route.name}`, async () => {
      const { DELETE } = await import(route.mod)
      const params = Promise.resolve({ id: ABSENT_ID })
      // activity-logs takes the id in the body; the rest take a route param.
      const req = new Request('http://localhost/x', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: ABSENT_ID }),
      })
      const res = await (DELETE as (r: Request, ctx?: unknown) => Promise<Response>)(req, { params })
      expect(res.status, `${route.name} must not report a no-op delete as a success`).toBe(404)
    })
  }
})
