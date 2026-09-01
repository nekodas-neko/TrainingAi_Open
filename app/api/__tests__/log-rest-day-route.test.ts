/**
 * BF-84 — `/api/log-rest-day` and the `rest_days` push branch must be one write path.
 *
 * The route used to persist nothing at all, so there was no drift to prevent. There is now, and
 * this is the domain where the standing rule bites hardest: the choice is made on the APK, which
 * reaches the server through `pushMutations` and not through this route. A branch that diverges
 * here means the web half works while every device choice strands silently.
 *
 * The load-bearing case is the malformed payload. `resting` is a boolean, and a **missing** field
 * must not read as `false` — that would silently withdraw a rest day the user chose, which is the
 * one failure worse than not recording it. Asserted by mutation: defaulting it to `p.resting !==
 * false` makes "a payload with no `resting`" pass a withdrawal through.
 *
 * Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER  = '00000000-0000-4000-8000-00000000bf86'
const OTHER = '00000000-0000-4000-8000-00000000bf87'
const TZ    = 'Australia/Brisbane'
const DATE  = '2026-08-19'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER, timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

describe.skipIf(!canRun)('POST /api/log-rest-day (BF-84)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository
  let POST: typeof import('@/app/api/log-rest-day/route').POST
  let GET: typeof import('@/app/api/log-rest-day/route').GET

  /** `body === undefined` posts no body at all — what the pre-BF-84 client sent, and still does. */
  const post = (body?: unknown) =>
    POST(new Request('http://localhost/api/log-rest-day', body === undefined
      ? { method: 'POST' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

  const rows = async (userId = USER) => (await pool.query(
    `SELECT date::text AS date, deleted_at FROM rest_days WHERE user_id = $1 ORDER BY date`, [userId])).rows

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    const route = await import('@/app/api/log-rest-day/route')
    POST = route.POST; GET = route.GET
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3) ON CONFLICT (id) DO NOTHING`,
        [id, `bf84-route-${id}@example.com`, TZ])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query('DELETE FROM rest_days WHERE user_id = ANY($1)', [[USER, OTHER]])
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[USER, OTHER]])
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM rest_days WHERE user_id = ANY($1)', [[USER, OTHER]])
  })

  it('a bodiless POST still means "rest today"', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.resting).toBe(true)
    expect(await repo.isRestDayChosen(USER, body.date)).toBe(true)
  })

  it('takes an explicit date and withdraws on resting:false', async () => {
    expect((await post({ date: DATE })).status).toBe(200)
    expect(await repo.isRestDayChosen(USER, DATE)).toBe(true)

    expect((await post({ date: DATE, resting: false })).status).toBe(200)
    expect(await repo.isRestDayChosen(USER, DATE)).toBe(false)
    expect((await rows())[0].deleted_at).not.toBeNull()
  })

  it('accepts the slash form the client actually sends', async () => {
    // localDateString() emits YYYY/MM/DD — a dash-only schema rejects every real request before the
    // handler runs (Q-130), and the failure is invisible until a client fills the param that way.
    expect((await post({ date: '2026/08/20' })).status).toBe(200)
    expect(await repo.isRestDayChosen(USER, '2026-08-20')).toBe(true)
  })

  it('rejects a date-shaped string that is not a real day', async () => {
    expect((await post({ date: '2026-02-31' })).status).toBe(400)
    expect(await rows()).toEqual([])
  })

  it('GET lists the chosen days in a window', async () => {
    await post({ date: '2026-08-19' })
    await post({ date: '2026-08-21' })
    const res = await GET(new Request('http://localhost/api/log-rest-day?from=2026-08-19&to=2026-08-20'))
    expect(await res.json()).toEqual({ dates: ['2026-08-19'] })
  })

  describe('the sync-push branch mirrors it', () => {
    it('produces identical state to the route', async () => {
      await post({ date: DATE })
      const viaRoute = await rows()

      await pool.query('DELETE FROM rest_days WHERE user_id = $1', [USER])
      const out = await repo.pushMutations(USER, [
        { id: 'm1', domain: 'rest_days', date: DATE, payload: { resting: true } },
      ])
      expect(out.processed).toBe(1)
      expect(out.errors).toEqual([])
      expect(await rows()).toEqual(viaRoute)
    })

    it('withdraws through the push path too, and tombstones rather than deleting', async () => {
      await post({ date: DATE })
      const out = await repo.pushMutations(USER, [
        { id: 'm2', domain: 'rest_days', date: DATE, payload: { resting: false } },
      ])
      expect(out.processed).toBe(1)
      expect(await repo.isRestDayChosen(USER, DATE)).toBe(false)
      expect(await rows()).toHaveLength(1)
    })

    // End-to-end on the envelope's date, not on the branch's slash→dash replace — that replace was
    // mutated out and nothing failed, because Postgres parses the slash literal to the same day.
    it('accepts the slash date form through the push envelope', async () => {
      const out = await repo.pushMutations(USER, [
        { id: 'm3', domain: 'rest_days', date: '2026/08/22', payload: { resting: true } },
      ])
      expect(out.errors).toEqual([])
      expect(await repo.isRestDayChosen(USER, '2026-08-22')).toBe(true)
    })

    // The one that matters: an absent `resting` must NOT be read as a withdrawal.
    it('quarantines a payload with no `resting`, leaving the choice standing', async () => {
      await post({ date: DATE })
      const out = await repo.pushMutations(USER, [
        { id: 'bad', domain: 'rest_days', date: DATE, payload: {} },
        { id: 'good', domain: 'rest_days', date: '2026-08-23', payload: { resting: true } },
      ])
      expect(out.errors.map(e => e.id)).toEqual(['bad'])
      expect(out.processed).toBe(1)
      // The bad mutation neither withdrew the existing choice nor blocked the one behind it.
      expect(await repo.isRestDayChosen(USER, DATE)).toBe(true)
      expect(await repo.isRestDayChosen(USER, '2026-08-23')).toBe(true)
    })

    it('quarantines a non-boolean `resting`', async () => {
      await post({ date: DATE })
      const out = await repo.pushMutations(USER, [
        { id: 'x', domain: 'rest_days', date: DATE, payload: { resting: 'false' } },
      ])
      expect(out.errors).toHaveLength(1)
      expect(await repo.isRestDayChosen(USER, DATE)).toBe(true)
    })

    it('writes as the pushing user, never the payload', async () => {
      await repo.pushMutations(OTHER, [
        { id: 'm4', domain: 'rest_days', date: DATE, payload: { resting: true, userId: USER } },
      ])
      expect(await repo.isRestDayChosen(OTHER, DATE)).toBe(true)
      expect(await repo.isRestDayChosen(USER, DATE)).toBe(false)
    })
  })
})
