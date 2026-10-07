// #2338 — POST /api/sleep-sessions/manual and the `manual_sleep` push branch: one write path, one row
// per night, and a device night always wins.
//
// Runs only against a real Postgres (DATABASE_URL) — skips cleanly without one.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER  = '00000000-0000-4000-8000-000000002338'
const OTHER = '00000000-0000-4000-8000-000000002339'
const TZ = 'Australia/Brisbane'
const NOW = new Date('2026-10-07T02:00:00.000Z') // 12:00 Brisbane
const DATE = '2026-10-07'
const BED  = '2026-10-06T12:30:00.000Z'          // 22:30 Brisbane
const WAKE = '2026-10-06T20:30:00.000Z'          // 06:30 Brisbane, waking on the 7th

const auth = vi.hoisted(() => ({ user: { id: '00000000-0000-4000-8000-000000002338', timezone: 'Australia/Brisbane' } as { id: string; timezone: string } | null }))
const limiter = vi.hoisted(() => ({ allow: true }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (auth.user ? { user: auth.user } : null)) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => limiter.allow }))

describe.skipIf(!canRun)('manual sleep entry (#2338)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository
  let POST: typeof import('@/app/api/sleep-sessions/manual/route').POST

  const post = (body: unknown) =>
    POST(new Request('http://localhost/api/sleep-sessions/manual', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }))
  const rows = async (userId = USER) => (await pool.query(
    `SELECT id, user_id, date::text AS date, sleep_start, sleep_end, duration_hours, time_in_bed_hours,
            awake_hours, efficiency, oura_id, manual_entry, source_map
       FROM sleep_sessions WHERE user_id = $1 ORDER BY sleep_start`, [userId])).rows
  const seedDevice = async (o: { start: string; end: string; hours: number; ouraId?: string | null; date?: string }) => {
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, efficiency, oura_id, source_map)
       VALUES ($1,$2,$3,$4,$5,90,$6,$7)`,
      [USER, o.date ?? DATE, o.start, o.end, o.hours, o.ouraId ?? null,
       JSON.stringify({ duration_hours: o.ouraId ? 'oura_ble' : 'health_connect' })])
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    POST = (await import('@/app/api/sleep-sessions/manual/route')).POST
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3) ON CONFLICT (id) DO NOTHING`,
        [id, `manual-sleep-${id}@example.com`, TZ])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[USER, OTHER]]) // cascades sleep_sessions
  })

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    auth.user = { id: USER, timezone: TZ }
    limiter.allow = true
    await pool.query('DELETE FROM sleep_sessions WHERE user_id = ANY($1)', [[USER, OTHER]])
    return () => vi.useRealTimers()
  })

  describe('the route', () => {
    it('401s without a session and writes nothing', async () => {
      auth.user = null
      expect((await post({ sleepStart: BED, sleepEnd: WAKE })).status).toBe(401)
      expect(await rows()).toEqual([])
    })

    it('429s past the rate limit and writes nothing', async () => {
      limiter.allow = false
      expect((await post({ sleepStart: BED, sleepEnd: WAKE })).status).toBe(429)
      expect(await rows()).toEqual([])
    })

    it('400s a malformed or implausible night and writes nothing', async () => {
      for (const body of [
        {}, { sleepStart: BED }, { sleepStart: 'late', sleepEnd: WAKE },
        { sleepStart: WAKE, sleepEnd: BED },                                     // wake before bed
        { sleepStart: '2026-10-05T12:30:00.000Z', sleepEnd: WAKE },              // 32 h
        { sleepStart: '2026-10-07T01:00:00.000Z', sleepEnd: '2026-10-07T09:00:00.000Z' }, // future
        { sleepStart: BED, sleepEnd: WAKE, date: '2026-10-01' },                 // strict: no client date
      ]) {
        expect((await post(body)).status, JSON.stringify(body)).toBe(400)
      }
      expect(await rows()).toEqual([])
    })

    it('stores one manual night for the session user, dated by the wake time in their timezone', async () => {
      const res = await post({ sleepStart: BED, sleepEnd: WAKE })
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('private, no-store')
      const body = await res.json()
      expect(body).toMatchObject({ ok: true, date: DATE, shadowed: false })
      const [r] = await rows()
      expect(r).toMatchObject({
        id: body.id, user_id: USER, date: DATE, sleep_start: new Date(BED), sleep_end: new Date(WAKE),
        duration_hours: 8, time_in_bed_hours: 8, awake_hours: null, efficiency: null, oura_id: null,
        manual_entry: true,
      })
    })

    // Ownership is the session's, never the body's: a body naming another user is refused by the
    // strict schema, and nothing lands on either account.
    it('refuses a body that names a user, and never writes to another account', async () => {
      expect((await post({ sleepStart: BED, sleepEnd: WAKE, userId: OTHER })).status).toBe(400)
      expect((await post({ sleepStart: BED, sleepEnd: WAKE })).status).toBe(200)
      expect(await rows(OTHER)).toEqual([])
      expect(await rows(USER)).toHaveLength(1)
    })

    it('refuses an id that is already another user\'s row, without touching it', async () => {
      auth.user = { id: OTHER, timezone: TZ }
      const theirs = await (await post({ sleepStart: BED, sleepEnd: WAKE })).json()
      auth.user = { id: USER, timezone: TZ }
      const res = await post({ id: theirs.id, sleepStart: '2026-10-06T13:00:00.000Z', sleepEnd: WAKE })
      expect(res.status).toBe(409)
      expect(await rows(USER)).toEqual([])
      expect((await rows(OTHER))[0]).toMatchObject({ id: theirs.id, sleep_start: new Date(BED) })
    })

    // The natural key is (user, wake date, manual): posting the same night twice is one row, and a
    // second, different entry for that night edits the first in place.
    it('is idempotent per night, and a second entry edits the first', async () => {
      const first = await (await post({ sleepStart: BED, sleepEnd: WAKE })).json()
      const again = await (await post({ sleepStart: BED, sleepEnd: WAKE })).json()
      expect(again.id).toBe(first.id)
      expect(await rows()).toHaveLength(1)

      const edited = await (await post({ sleepStart: '2026-10-06T13:30:00.000Z', sleepEnd: WAKE })).json()
      expect(edited.id).toBe(first.id)
      const all = await rows()
      expect(all).toHaveLength(1)
      expect(all[0]).toMatchObject({ sleep_start: new Date('2026-10-06T13:30:00.000Z'), duration_hours: 7 })
    })

    it('keeps the entry but reports it shadowed when a device already recorded the night', async () => {
      await seedDevice({ start: '2026-10-06T13:10:00.000Z', end: '2026-10-06T20:05:00.000Z', hours: 6.4, ouraId: 'ble:100' })
      const body = await (await post({ sleepStart: BED, sleepEnd: WAKE })).json()
      expect(body.shadowed).toBe(true)
      expect((await rows()).map(r => r.manual_entry)).toEqual([true, false])
    })

    it('stores nothing when a device night starts at the very same instant — that row is this night', async () => {
      await seedDevice({ start: BED, end: '2026-10-06T20:05:00.000Z', hours: 7.4, ouraId: null })
      const body = await (await post({ sleepStart: BED, sleepEnd: WAKE })).json()
      expect(body).toMatchObject({ ok: true, id: null, shadowed: true })
      const all = await rows()
      expect(all).toHaveLength(1)
      expect(all[0]).toMatchObject({ manual_entry: false, duration_hours: 7.4 })
    })
  })

  describe('the push branch writes what the route writes', () => {
    it('produces the same row as the route', async () => {
      await post({ sleepStart: BED, sleepEnd: WAKE })
      const [viaRoute] = await rows()
      await pool.query('DELETE FROM sleep_sessions WHERE user_id = $1', [USER])

      const id = '6f1c2a4e-0b7d-4c1e-9a55-2338aa0000a1'
      const out = await repo.pushMutations(USER, [
        { id: 'm1', domain: 'manual_sleep', date: DATE, payload: { id, sleepStart: BED, sleepEnd: WAKE } },
      ])
      expect(out.errors).toEqual([])
      expect(out.processed).toBe(1)
      const [viaPush] = await rows()
      expect(viaPush.id).toBe(id) // the device's own id, so the mirror stays one row
      const { id: _a, ...route } = viaRoute
      const { id: _b, ...push } = viaPush
      void _a; void _b
      expect(push).toEqual(route)
    })

    it('a replayed mutation is still one row', async () => {
      const m = { id: 'm1', domain: 'manual_sleep', date: DATE, payload: { id: '6f1c2a4e-0b7d-4c1e-9a55-2338aa0000a2', sleepStart: BED, sleepEnd: WAKE } }
      await repo.pushMutations(USER, [m])
      const again = await repo.pushMutations(USER, [{ ...m, id: 'm2' }])
      expect(again.errors).toEqual([])
      expect(await rows()).toHaveLength(1)
    })

    it('files the night by the wake time in the user\'s timezone, not the envelope date', async () => {
      const out = await repo.pushMutations(USER, [
        { id: 'm1', domain: 'manual_sleep', date: '2026-10-06', payload: { id: '6f1c2a4e-0b7d-4c1e-9a55-2338aa0000a3', sleepStart: BED, sleepEnd: WAKE } },
      ])
      expect(out.errors).toEqual([])
      expect((await rows())[0].date).toBe(DATE)
    })

    it('quarantines an implausible or malformed night without blocking the queue', async () => {
      const out = await repo.pushMutations(USER, [
        { id: 'bad1', domain: 'manual_sleep', date: DATE, payload: { id: '6f1c2a4e-0b7d-4c1e-9a55-2338aa0000a4', sleepStart: WAKE, sleepEnd: BED } },
        { id: 'bad2', domain: 'manual_sleep', date: DATE, payload: { sleepStart: 'late', sleepEnd: WAKE } },
        { id: 'good', domain: 'manual_sleep', date: DATE, payload: { id: '6f1c2a4e-0b7d-4c1e-9a55-2338aa0000a5', sleepStart: BED, sleepEnd: WAKE } },
      ])
      expect(out.errors.map(e => e.id)).toEqual(['bad1', 'bad2'])
      expect(out.processed).toBe(1)
      expect(await rows()).toHaveLength(1)
    })
  })

  describe('a device night always wins (the ranked merge)', () => {
    it('listSleepSessions drops the manual night when a device recorded the same night', async () => {
      await post({ sleepStart: BED, sleepEnd: WAKE })
      expect((await repo.listSleepSessions(USER, DATE, DATE)).map(r => r.manualEntry)).toEqual([true])
      await seedDevice({ start: '2026-10-06T13:10:00.000Z', end: '2026-10-06T20:05:00.000Z', hours: 6.4, ouraId: null })
      const seen = await repo.listSleepSessions(USER, DATE, DATE)
      expect(seen).toHaveLength(1)
      expect(seen[0]).toMatchObject({ manualEntry: false, durationHours: 6.4 })
    })

    it('a device row written at the manual night\'s exact start takes the row over', async () => {
      await post({ sleepStart: BED, sleepEnd: WAKE })
      await repo.saveSleepSession(USER, {
        date: DATE, sleepStart: new Date(BED), sleepEnd: new Date('2026-10-06T20:00:00.000Z'), durationHours: 7.2,
      }, 'health_connect')
      const all = await rows()
      expect(all).toHaveLength(1)
      expect(all[0]).toMatchObject({
        manual_entry: false, duration_hours: 7.2, sleep_end: new Date('2026-10-06T20:00:00.000Z'), time_in_bed_hours: null,
      })
    })

    // The rollup deletes and reinserts every BLE row for the dates it re-rolls. It must only ever
    // touch its own rows: a manual night on one of those dates survives the pass.
    it('the ring rollup\'s re-roll delete never touches a manual night', async () => {
      await seedDevice({ start: '2026-10-06T13:10:00.000Z', end: '2026-10-06T20:05:00.000Z', hours: 6.4, ouraId: 'ble:200' })
      await post({ sleepStart: BED, sleepEnd: WAKE })
      const { createPostgresRollupIO } = await import('@/lib/data/postgres/rollup-io')
      const { getDb } = await import('@/lib/data/postgres/client')
      const io = createPostgresRollupIO({ db: getDb(), userId: USER } as never)
      await io.deleteBleSleepSessionsForDates([DATE])
      const left = await rows()
      expect(left).toHaveLength(1)
      expect(left[0]).toMatchObject({ manual_entry: true, sleep_start: new Date(BED) })
      // …and once the ring night is gone, the manual one is the night again.
      expect((await repo.listSleepSessions(USER, DATE, DATE)).map(r => r.manualEntry)).toEqual([true])
    })

    it('the ring rollup\'s reinsert never overwrites a manual night it does not start with', async () => {
      await post({ sleepStart: BED, sleepEnd: WAKE })
      const { createPostgresRollupIO } = await import('@/lib/data/postgres/rollup-io')
      const { getDb } = await import('@/lib/data/postgres/client')
      const io = createPostgresRollupIO({ db: getDb(), userId: USER } as never)
      await io.upsertSleepSessions([{
        ouraId: 'ble:300', date: DATE, sleepStart: new Date('2026-10-06T13:10:00.000Z'),
        sleepEnd: new Date('2026-10-06T20:05:00.000Z'), durationHours: 6.4,
      }])
      const all = await rows()
      expect(all.map(r => [r.manual_entry, r.duration_hours])).toEqual([[true, 8], [false, 6.4]])
    })
  })
})
