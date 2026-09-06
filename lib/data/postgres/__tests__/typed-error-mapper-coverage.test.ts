import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

// RV-46. Eighteen repository methods throw a typed `NotFoundError`/`UserFacingError`; thirteen
// mutating routes call one. Twelve mapped it through `refusalResponse`/`routeErrorResponse`. The
// thirteenth — `PATCH /api/admin/activity-types` — wrapped only `requireAdmin` in its `try`, so
// `updateActivityType`'s throw escaped on the handler's last line:
//
//   PATCH {"id":"walk",                  …}  ->  200
//   PATCH {"id":"no-such-activity-type", …}  ->  500, empty body
//
// Both symptoms `route-errors.ts` names in its own header: the wrong status, and the empty body
// that makes a client's `res.json()` throw on top of the failure. It also wrote the row that helper
// exists to prevent — `PATCH /api/admin/activity-types | server | Activity type not found`, a
// correctly-refused request recorded as a server fault.
const USER = '00000000-0000-4000-8000-0000000046aa'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER, timezone: 'Australia/Brisbane', isAdmin: true } })),
}))

const canRun = !!process.env.DATABASE_URL

describe.skipIf(!canRun)('a typed repository error becomes a status, not a 500 (RV-46)', () => {
  let pool: import('pg').Pool

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin)
       VALUES ($1, $2, 'x', 'Australia/Brisbane', true) ON CONFLICT (id) DO NOTHING`,
      [USER, `rv46-${USER}@example.com`])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [USER])
  })

  it('PATCH /api/admin/activity-types answers 404 for an id that is not there', async () => {
    const { PATCH } = await import('@/app/api/admin/activity-types/route')
    const res = await PATCH(new Request('http://localhost/x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'no-such-activity-type', sortOrder: 1 }),
    }) as never)
    expect(res.status).toBe(404)
    // The empty body is half the defect and is not covered by the status assertion: a client
    // calling res.json() on the old 500 threw a parse exception on top of the failure.
    await expect(res.json()).resolves.toEqual({ error: 'Activity type not found' })
  })
})

// The route above was the last unconverted site of a class the repo had already decided how to fix,
// which is the only reason a one-line change earned an entry. This half is what stops the next one
// appearing: it reads source rather than making requests, so a NEW route calling a throwing method
// without a mapper fails here instead of in production.
describe('every route calling a throwing repository method maps its error', () => {
  // Methods whose own body throws a typed error. Derived by reading each implementation, not by a
  // proximity grep — a `-B40` window over the adapter attributes a throw to whichever method
  // happens to sit above it, which credited `createActivityType` and `createInjury` with throws
  // neither of them contains.
  const THROWING = [
    'adminUpdateExercise', 'createExercise', 'renameExercise', 'deleteExercise',
    'updateActivityType', 'updateInjury', 'updateSupplement', 'logSupplement',
    'deleteSupplement', 'ensureWorkoutSession',
  ]
  const MAPPERS = /\b(routeErrorResponse|withRouteErrors|refusalResponse)\s*\(/

  // Comments are stripped first, and that is not fastidiousness: the first version of this scan
  // matched the plain text of the fix's own explanatory comment on the route it was written for, so
  // reverting the fix left the scan green. A source check that reads prose is checking the wrong
  // file.
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  // A hand-rolled walk rather than `fs.globSync`, which is Node 22+ and does not exist on the
  // Node 20 the CI jobs run: the first version passed locally and threw `globSync is not a
  // function` in the Tests job.
  function routeFiles(dir: string, found: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) routeFiles(full, found)
      else if (e.name === 'route.ts') found.push(full)
    }
    return found
  }

  it('and the list of such routes is not silently growing', async () => {
    const files = routeFiles(join(process.cwd(), 'app/api'))
    // A walk that finds nothing also finds nothing unmapped, so the count is the control.
    expect(files.length).toBeGreaterThan(100)
    const unmapped: string[] = []
    for (const rel of files) {
      const src = stripComments(readFileSync(rel, 'utf8'))
      const calls = THROWING.filter(m => src.includes(`repo.${m}(`))
      if (calls.length && !MAPPERS.test(src)) {
        unmapped.push(`${relative(process.cwd(), rel)} calls ${calls.join(', ')}`)
      }
    }
    expect(unmapped, 'a route calling a throwing repository method needs routeErrorResponse/refusalResponse').toEqual([])
  })
})
