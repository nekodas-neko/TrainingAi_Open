// #2265 — marking a measured night partial: POST /api/sleep-sessions/partial and the `partial_night`
// push branch, one repository call. A flag on the night's device rows, never a delete; the stored
// Sleep Score is re-scored by the same bracket an Oura revision gets.
//
// Runs only against a real Postgres (DATABASE_URL) — skips cleanly without one.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER  = '00000000-0000-4000-8000-000000002265'
const OTHER = '00000000-0000-4000-8000-000000002266'
const TZ = 'Australia/Brisbane'
const NOW = new Date('2026-10-07T02:00:00.000Z') // 12:00 Brisbane
const DATE = '2026-10-07'
const OTHER_DATE = '2026-10-06'
const UNKNOWN = '6f1c2a4e-0b7d-4c1e-9a55-2265aa0000ff'

const auth = vi.hoisted(() => ({ user: { id: '00000000-0000-4000-8000-000000002265', timezone: 'Australia/Brisbane' } as { id: string; timezone: string } | null }))
const limiter = vi.hoisted(() => ({ allow: true }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (auth.user ? { user: auth.user } : null)) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => limiter.allow }))

describe.skipIf(!canRun)('marking a night partial (#2265)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let route: typeof import('@/app/api/sleep-sessions/partial/route')

  const post = (body: unknown) =>
    route.POST(new Request('http://localhost/api/sleep-sessions/partial', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }))
  const rows = async (userId = USER): Promise<Record<string, unknown>[]> => (await pool.query(
    `SELECT id, date::text AS date, duration_hours, average_hrv_ms, partial_night_at, updated_at, deleted_at, manual_entry
       FROM sleep_sessions WHERE user_id = $1 ORDER BY sleep_start, id`, [userId])).rows
  const markOf = async (id: string) => (await rows()).find(r => r.id === id)!.partial_night_at as Date | null
  const seed = async (userId: string, date: string, start: string, end: string, hours: number, ouraId: string, manual = false) =>
    (await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, efficiency, average_hrv_ms, oura_id, manual_entry, source_map)
       VALUES ($1,$2,$3,$4,$5,90,47,$6,$7,$8) RETURNING id`,
      [userId, date, start, end, hours, ouraId, manual, JSON.stringify({ duration_hours: 'oura_cloud' })])).rows[0].id as string
  const night = (ouraId = 'cloud-2265') => seed(USER, DATE, '2026-10-06T18:40:00Z', '2026-10-06T21:55:00Z', 3.25, ouraId)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    route = await import('@/app/api/sleep-sessions/partial/route')
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3) ON CONFLICT (id) DO NOTHING`,
        [id, `partial-night-${id}@example.com`, TZ])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[USER, OTHER]])
  })

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    auth.user = { id: USER, timezone: TZ }
    limiter.allow = true
    await pool.query('DELETE FROM sleep_sessions WHERE user_id = ANY($1)', [[USER, OTHER]])
    await pool.query('DELETE FROM oura_daily_derived WHERE user_id = ANY($1)', [[USER, OTHER]])
    return () => vi.useRealTimers()
  })

  describe('the route', () => {
    it('401s without a session and changes nothing', async () => {
      const id = await night()
      auth.user = null
      expect((await post({ id, partial: true })).status).toBe(401)
      expect(await markOf(id)).toBeNull()
    })

    it('429s past the rate limit and changes nothing', async () => {
      const id = await night()
      limiter.allow = false
      expect((await post({ id, partial: true })).status).toBe(429)
      expect(await markOf(id)).toBeNull()
    })

    it('400s a malformed body, including a stray field, and changes nothing', async () => {
      const id = await night()
      for (const body of [{}, { id }, { partial: true }, { id: 'nope', partial: true }, { id, partial: 'yes' }, { id, partial: true, userId: OTHER }]) {
        expect((await post(body)).status, JSON.stringify(body)).toBe(400)
      }
      expect(await markOf(id)).toBeNull()
    })

    it('marks the night, keeps every measured value, and unmarking clears the flag', async () => {
      const id = await night()
      const before = (await rows())[0]
      const marked = await post({ id, partial: true })
      expect(marked.status).toBe(200)
      expect(await marked.json()).toEqual({ ok: true, partial: true })
      expect(marked.headers.get('Cache-Control')).toBe('private, no-store')
      const after = (await rows())[0]
      expect(after.partial_night_at).toBeInstanceOf(Date)
      expect(after).toMatchObject({ id, duration_hours: 3.25, average_hrv_ms: 47, deleted_at: null })
      expect((after.updated_at as Date).getTime()).toBeGreaterThanOrEqual((before.updated_at as Date).getTime())

      expect((await post({ id, partial: false })).status).toBe(200)
      expect(await markOf(id)).toBeNull()
      expect((await rows())[0]).toMatchObject({ id, duration_hours: 3.25, average_hrv_ms: 47 })
    })

    it('is idempotent both ways', async () => {
      const id = await night()
      expect((await post({ id, partial: false })).status).toBe(200)
      expect((await post({ id, partial: true })).status).toBe(200)
      expect((await post({ id, partial: true })).status).toBe(200)
      expect(await markOf(id)).toBeInstanceOf(Date)
    })

    it('marks every device row of the wake date and no other date, so a split night is never half marked', async () => {
      const first = await night('cloud-a')
      const second = await seed(USER, DATE, '2026-10-06T23:00:00Z', '2026-10-07T00:30:00Z', 1.4, 'cloud-b')
      const elsewhere = await seed(USER, OTHER_DATE, '2026-10-05T13:00:00Z', '2026-10-05T21:00:00Z', 8, 'cloud-c')
      expect((await post({ id: second, partial: true })).status).toBe(200)
      expect(await markOf(first)).toBeInstanceOf(Date)
      expect(await markOf(second)).toBeInstanceOf(Date)
      expect(await markOf(elsewhere)).toBeNull()
      expect((await post({ id: first, partial: false })).status).toBe(200)
      expect(await markOf(second)).toBeNull()
    })

    it('404s an id that is not the caller\'s live device night, and changes nothing', async () => {
      const theirs = await seed(OTHER, DATE, '2026-10-06T18:00:00Z', '2026-10-07T00:00:00Z', 6, 'cloud-theirs')
      const typed = await seed(USER, OTHER_DATE, '2026-10-05T13:00:00Z', '2026-10-05T21:00:00Z', 8, 'manual-typed', true)
      const removed = await night('cloud-removed')
      await pool.query('UPDATE sleep_sessions SET deleted_at = NOW() WHERE id = $1', [removed])
      for (const id of [UNKNOWN, theirs, typed, removed]) {
        expect((await post({ id, partial: true })).status, id).toBe(404)
      }
      expect((await rows(OTHER))[0].partial_night_at).toBeNull()
      expect((await rows()).every(r => r.partial_night_at === null)).toBe(true)
    })
  })

  describe('what readers see', () => {
    it('listSleepSessions carries the mark, and null when unmarked', async () => {
      const id = await night()
      expect((await repo.listSleepSessions(USER, DATE, DATE))[0].partialNightAt).toBeNull()
      await post({ id, partial: true })
      const [row] = await repo.listSleepSessions(USER, DATE, DATE)
      expect(row.partialNightAt).toBeInstanceOf(Date)
      expect(row.durationHours).toBe(3.25)
      expect(row.averageHrvMs).toBe(47)
    })

    it('/api/sleep-sessions returns it as an ISO string', async () => {
      const id = await night()
      await post({ id, partial: true })
      const sleepRoute = await import('@/app/api/sleep-sessions/route')
      const res = await sleepRoute.GET()
      const body = await res.json() as { id: string; partialNightAt: string | null; durationHours: number | null }[]
      expect(body.find(r => r.id === id)).toMatchObject({ partialNightAt: expect.stringMatching(/^2026-10-07T/), durationHours: 3.25 })
    })

    it('re-scores the stored Sleep Score: cleared while marked, back to the original on unmarking', async () => {
      const id = await night()
      await repo.upsertOuraDailyDerived(USER, DATE, { sleepScore: 41 })
      const stored = async () => (await repo.getOuraDailyDerived(USER, DATE, DATE))[0]?.sleepScore ?? null

      await post({ id, partial: true })
      expect(await stored()).toBeNull()

      await post({ id, partial: false })
      const { scoreNightForDate } = await import('@/lib/health/rescore-nights')
      const expected = scoreNightForDate(await repo.listSleepSessions(USER, '2026-09-01', DATE), DATE, TZ)!.score
      expect(await stored()).toBe(expected)
    })

    it('re-scores a night older than the ingest window, and unmarking brings the original back', async () => {
      const old = '2026-09-25' // 12 days before NOW, outside the 7-day ingest window
      const id = await seed(USER, old, '2026-09-24T12:30:00Z', '2026-09-24T20:30:00Z', 8, 'cloud-old')
      const { scoreNightForDate } = await import('@/lib/health/rescore-nights')
      const original = scoreNightForDate(await repo.listSleepSessions(USER, '2026-08-01', DATE), old, TZ)!.score
      await repo.upsertOuraDailyDerived(USER, old, { sleepScore: original })
      const stored = async () => (await repo.getOuraDailyDerived(USER, old, old))[0]?.sleepScore ?? null

      expect((await post({ id, partial: true })).status).toBe(200)
      expect(await stored()).toBeNull()
      expect((await post({ id, partial: false })).status).toBe(200)
      expect(await stored()).toBe(original)
    })

    it('a device write that re-delivers the night does not clear the mark', async () => {
      const id = await night('cloud-redeliver')
      await post({ id, partial: true })
      const { upsertOuraSleep } = await import('@/lib/data/postgres/slices/oura')
      const { getDb } = await import('@/lib/data/postgres/client')
      await upsertOuraSleep(getDb(), USER, [{
        date: DATE, sleepStart: new Date('2026-10-06T18:40:00Z'), sleepEnd: new Date('2026-10-06T21:55:00Z'),
        durationHours: 3.2, ouraId: 'cloud-redeliver', averageHrvMs: 62,
      }] as never, 'oura_cloud', { replaceOwnCloud: true })
      expect(await markOf(id)).toBeInstanceOf(Date)
    })
  })

  describe('the push branch writes what the route writes', () => {
    const mut = (id: string, partial: boolean, mid = 'p1') => ({ id: mid, domain: 'partial_night' as const, date: DATE, payload: { id, partial } })

    it('marks, replays, and unmarks in outbox order', async () => {
      const id = await night()
      let out = await repo.pushMutations(USER, [mut(id, true)])
      expect(out.errors).toEqual([])
      expect(out.processed).toBe(1)
      const first = await markOf(id)
      expect(first).toBeInstanceOf(Date)
      out = await repo.pushMutations(USER, [mut(id, true, 'p2')])
      expect(out.processed).toBe(1)
      out = await repo.pushMutations(USER, [mut(id, false, 'p3')])
      expect(out.errors).toEqual([])
      expect(await markOf(id)).toBeNull()
    })

    it('quarantines a night that is not the caller\'s, a typed night and a malformed payload, without blocking the queue', async () => {
      const theirs = await seed(OTHER, DATE, '2026-10-06T18:00:00Z', '2026-10-07T00:00:00Z', 6, 'cloud-theirs')
      const typed = await seed(USER, OTHER_DATE, '2026-10-05T13:00:00Z', '2026-10-05T21:00:00Z', 8, 'manual-typed', true)
      const good = await night()
      const out = await repo.pushMutations(USER, [
        mut(UNKNOWN, true, 'bad-unknown'), mut(theirs, true, 'bad-theirs'), mut(typed, true, 'bad-typed'),
        { id: 'bad-shape', domain: 'partial_night', date: DATE, payload: { id: good, partial: 'yes' } },
        mut(good, true, 'good'),
      ])
      expect(out.errors.map((e: { id?: string }) => e.id)).toEqual(['bad-unknown', 'bad-theirs', 'bad-typed', 'bad-shape'])
      expect(out.processed).toBe(1)
      expect(await markOf(good)).toBeInstanceOf(Date)
      expect((await rows(OTHER))[0].partial_night_at).toBeNull()
    })
  })
})
