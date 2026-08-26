// Q-519 — the route and the sync-push branch must be one write path.
//
// The standing rule exists because these two have drifted repeatedly and the failure is always the
// same shape: the web half works while the APK mutation strands silently. So this asserts they
// produce **identical database state**, not merely that each one works.
//
// Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER  = '00000000-0000-4000-8000-000000000521'
const DATE  = '2026-08-19'
const MEASURED_START = new Date('2026-08-18T18:23:00.000Z')
const MEASURED_END   = new Date('2026-08-18T22:03:00.000Z')
const REMEMBERED     = '2026-08-18T13:00:00.000Z'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER, timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

describe.skipIf(!canRun)('POST /api/sleep/manual-bedtime (Q-519)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository
  let POST: typeof import('@/app/api/sleep/manual-bedtime/route').POST

  const post = (body: unknown) =>
    POST(new Request('http://localhost/api/sleep/manual-bedtime', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }))

  const seedNight = async () => {
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, efficiency)
       VALUES ($1,$2,$3,$4,3.08,84)`, [USER, DATE, MEASURED_START, MEASURED_END])
  }
  const stored = async () => (await pool.query(
    `SELECT sleep_start, sleep_end, duration_hours, efficiency, manual_sleep_start
     FROM sleep_sessions WHERE user_id = $1 AND date = $2`, [USER, DATE])).rows[0]

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    POST = (await import('@/app/api/sleep/manual-bedtime/route')).POST
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1,$2,'x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [USER, `q519-route-${USER}@example.com`])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query('DELETE FROM sleep_sessions WHERE user_id = $1', [USER])
    await pool.query('DELETE FROM users WHERE id = $1', [USER])
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM sleep_sessions WHERE user_id = $1', [USER])
  })

  it('saves the bedtime and leaves the measured window alone', async () => {
    await seedNight()
    const res = await post({ date: DATE, at: REMEMBERED })
    expect(res.status).toBe(200)
    const row = await stored()
    expect(row.manual_sleep_start).toEqual(new Date(REMEMBERED))
    expect(row.sleep_start).toEqual(MEASURED_START)
    expect(row.duration_hours).toBe(3.08)
    expect(row.efficiency).toBe(84)
  })

  it('clears with null', async () => {
    await seedNight()
    await post({ date: DATE, at: REMEMBERED })
    expect((await post({ date: DATE, at: null })).status).toBe(200)
    expect((await stored()).manual_sleep_start).toBeNull()
  })

  // The client's `localDateString()` emits `YYYY/MM/DD`. A dash-only schema rejects every real
  // request with a Zod error before the handler runs — the ai-chat `localDate` shipped that way for
  // a full release.
  it('accepts the slash form the client actually sends', async () => {
    await seedNight()
    expect((await post({ date: '2026/08/19', at: REMEMBERED })).status).toBe(200)
    expect((await stored()).manual_sleep_start).toEqual(new Date(REMEMBERED))
  })

  it('404s for a date with no recorded night, rather than inventing one', async () => {
    const res = await post({ date: DATE, at: REMEMBERED })
    expect(res.status).toBe(404)
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM sleep_sessions WHERE user_id = $1', [USER])
    expect(rows[0].n).toBe(0)
  })

  it('rejects a malformed body rather than storing something arbitrary', async () => {
    await seedNight()
    for (const body of [
      { date: 'yesterday', at: REMEMBERED },
      { date: DATE, at: 'not-a-time' },
      { date: DATE },
      { date: DATE, at: REMEMBERED, sleepStart: REMEMBERED },  // .strict() — no smuggling
    ]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400)
    }
    expect((await stored()).manual_sleep_start).toBeNull()
  })

  // The rule this exists for: one bad mutation must never wedge the queue, and the push branch must
  // write exactly what the route writes.
  describe('the sync-push branch mirrors it', () => {
    it('produces identical state to the route', async () => {
      await seedNight()
      await post({ date: DATE, at: REMEMBERED })
      const viaRoute = await stored()

      await pool.query(
        'UPDATE sleep_sessions SET manual_sleep_start = NULL WHERE user_id = $1', [USER])
      const out = await repo.pushMutations(USER, [
        { id: 'm1', domain: 'manual_bedtime', date: DATE, payload: { at: REMEMBERED } },
      ])
      expect(out.processed).toBe(1)
      expect(out.errors).toEqual([])

      const viaPush = await stored()
      expect(viaPush.manual_sleep_start).toEqual(viaRoute.manual_sleep_start)
      expect(viaPush.sleep_start).toEqual(viaRoute.sleep_start)
      expect(viaPush.duration_hours).toBe(viaRoute.duration_hours)
      expect(viaPush.efficiency).toBe(viaRoute.efficiency)
    })

    it('clears with null through the push path too', async () => {
      await seedNight()
      await post({ date: DATE, at: REMEMBERED })
      const out = await repo.pushMutations(USER, [
        { id: 'm2', domain: 'manual_bedtime', date: DATE, payload: { at: null } },
      ])
      expect(out.processed).toBe(1)
      expect((await stored()).manual_sleep_start).toBeNull()
    })

    // A date with no session will not gain one on a retry, so it is a poison pill: quarantine it and
    // let the mutations behind it through.
    it('quarantines a mutation for a date with no night, without blocking the queue', async () => {
      await seedNight()
      const out = await repo.pushMutations(USER, [
        { id: 'bad', domain: 'manual_bedtime', date: '2026-08-01', payload: { at: REMEMBERED } },
        { id: 'good', domain: 'manual_bedtime', date: DATE, payload: { at: REMEMBERED } },
      ])
      expect(out.errors.map(e => e.id)).toEqual(['bad'])
      expect(out.processed).toBe(1)
      expect((await stored()).manual_sleep_start).toEqual(new Date(REMEMBERED))
    })

    it('quarantines an unparseable timestamp', async () => {
      await seedNight()
      const out = await repo.pushMutations(USER, [
        { id: 'x', domain: 'manual_bedtime', date: DATE, payload: { at: 'not-a-time' } },
      ])
      expect(out.errors).toHaveLength(1)
      expect((await stored()).manual_sleep_start).toBeNull()
    })
  })
})
