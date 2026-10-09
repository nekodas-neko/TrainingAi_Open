// Issue 2606 — removing a night the user entered by hand: DELETE /api/sleep-sessions/manual and the
// `manual_sleep` `{ id, deleted: true }` push branch, one repository call, a soft delete that every
// reader honours and the pull carries, and a removed night that comes back when it is entered again.
//
// Runs only against a real Postgres (DATABASE_URL) — skips cleanly without one.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER  = '00000000-0000-4000-8000-000000002606'
const OTHER = '00000000-0000-4000-8000-000000002607'
const TZ = 'Australia/Brisbane'
const NOW = new Date('2026-10-07T02:00:00.000Z') // 12:00 Brisbane
const DATE = '2026-10-07'
const BED  = '2026-10-06T12:30:00.000Z'          // 22:30 Brisbane
const WAKE = '2026-10-06T20:30:00.000Z'          // 06:30 Brisbane, waking on the 7th
const UNKNOWN = '6f1c2a4e-0b7d-4c1e-9a55-2606aa0000ff'

const auth = vi.hoisted(() => ({ user: { id: '00000000-0000-4000-8000-000000002606', timezone: 'Australia/Brisbane' } as { id: string; timezone: string } | null }))
const limiter = vi.hoisted(() => ({ allow: true }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (auth.user ? { user: auth.user } : null)) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => limiter.allow }))

describe.skipIf(!canRun)('removing a hand-entered night (issue 2606)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let route: typeof import('@/app/api/sleep-sessions/manual/route')

  const call = (method: 'POST' | 'DELETE', body: unknown) =>
    route[method](new Request('http://localhost/api/sleep-sessions/manual', {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }))
  const enter = async (body: Record<string, unknown> = { sleepStart: BED, sleepEnd: WAKE }) => {
    const res = await call('POST', body)
    expect(res.status).toBe(200)
    return (await res.json()) as { id: string; shadowed: boolean }
  }
  const rows = async (userId = USER): Promise<Record<string, unknown>[]> => (await pool.query(
    `SELECT id, date::text AS date, sleep_start, duration_hours, manual_entry, deleted_at, updated_at
       FROM sleep_sessions WHERE user_id = $1 ORDER BY sleep_start, id`, [userId])).rows
  const seedDevice = async (start: string, end: string, hours: number, ouraId: string | null = 'ble:2606') =>
    (await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, efficiency, oura_id, source_map)
       VALUES ($1,$2,$3,$4,$5,90,$6,$7) RETURNING id`,
      [USER, DATE, start, end, hours, ouraId, JSON.stringify({ duration_hours: 'oura_ble' })])).rows[0].id as string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    route = await import('@/app/api/sleep-sessions/manual/route')
    for (const id of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3) ON CONFLICT (id) DO NOTHING`,
        [id, `manual-sleep-remove-${id}@example.com`, TZ])
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
    it('401s without a session and changes nothing', async () => {
      const { id } = await enter()
      auth.user = null
      expect((await call('DELETE', { id })).status).toBe(401)
      expect((await rows())[0]).toMatchObject({ id, deleted_at: null })
    })

    it('429s past the rate limit and changes nothing', async () => {
      const { id } = await enter()
      limiter.allow = false
      expect((await call('DELETE', { id })).status).toBe(429)
      expect((await rows())[0]).toMatchObject({ id, deleted_at: null })
    })

    it('400s a malformed body, including a stray field, and changes nothing', async () => {
      const { id } = await enter()
      for (const body of [{}, { id: 'not-a-uuid' }, { id, userId: OTHER }, { id, deleted: true }, { date: DATE }]) {
        expect((await call('DELETE', body)).status, JSON.stringify(body)).toBe(400)
      }
      expect((await rows())[0]).toMatchObject({ id, deleted_at: null })
    })

    it('soft-deletes the caller\'s typed night: the row stays, tombstoned, with updated_at moved', async () => {
      const { id } = await enter()
      const [before] = await rows()
      vi.setSystemTime(new Date(NOW.getTime() + 60_000))
      const res = await call('DELETE', { id })
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('private, no-store')
      expect(await res.json()).toEqual({ ok: true, removed: true, alreadyRemoved: false })
      const [after] = await rows()
      expect(after).toMatchObject({ id, manual_entry: true, duration_hours: 8 })
      expect(after.deleted_at).toBeInstanceOf(Date)
      expect((after.updated_at as Date).getTime()).toBeGreaterThan((before.updated_at as Date).getTime())
    })

    it('is idempotent: removing it again answers alreadyRemoved and keeps the first removal time', async () => {
      const { id } = await enter()
      await call('DELETE', { id })
      const [first] = await rows()
      vi.setSystemTime(new Date(NOW.getTime() + 120_000))
      const res = await call('DELETE', { id })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, removed: true, alreadyRemoved: true })
      expect(await rows()).toEqual([first])
    })

    it('404s an id that is not the caller\'s — another user\'s night reads the same and is untouched', async () => {
      expect((await call('DELETE', { id: UNKNOWN })).status).toBe(404)
      auth.user = { id: OTHER, timezone: TZ }
      const theirs = await enter()
      auth.user = { id: USER, timezone: TZ }
      const res = await call('DELETE', { id: theirs.id })
      expect(res.status).toBe(404)
      expect((await rows(OTHER))[0]).toMatchObject({ id: theirs.id, deleted_at: null })
    })

    it('409s a night a device measured: only a typed night can be removed', async () => {
      const ring = await seedDevice('2026-10-06T13:10:00.000Z', '2026-10-06T20:05:00.000Z', 6.4)
      const res = await call('DELETE', { id: ring })
      expect(res.status).toBe(409)
      expect((await rows())[0]).toMatchObject({ id: ring, manual_entry: false, deleted_at: null })
      expect(await repo.deleteManualSleepNight(USER, ring)).toBe('not_manual')
    })
  })

  describe('a removed night disappears from every read', () => {
    it('for a user who never removed a night, the read is the same rows the unfiltered read ranks', async () => {
      await seedDevice('2026-10-05T13:00:00.000Z', '2026-10-05T20:00:00.000Z', 7, 'ble:2606-a')
      await seedDevice('2026-10-06T13:10:00.000Z', '2026-10-06T20:05:00.000Z', 6.4, 'ble:2606-b')
      await enter()
      const { preferDeviceNights } = await import('@trainingai/shared/health/sleep-night')
      const { rows: raw } = await pool.query(
        `SELECT id, date::text AS date, sleep_start AS "sleepStart", sleep_end AS "sleepEnd",
                duration_hours AS "durationHours", manual_entry AS "manualEntry", oura_id AS "ouraId", updated_at AS "updatedAt"
           FROM sleep_sessions WHERE user_id = $1 ORDER BY date DESC`, [USER])
      const expected = preferDeviceNights(raw as never[]).map((r: { id: string }) => r.id).sort()
      expect((await repo.listSleepSessions(USER, '2026-10-01', DATE)).map(r => r.id).sort()).toEqual(expected)
    })

    it('listSleepSessions and listSleepDayKeys skip it; the delta pull still carries it, tombstoned', async () => {
      const { id } = await enter()
      expect((await repo.listSleepSessions(USER, DATE, DATE)).map(r => r.id)).toEqual([id])
      expect(await repo.listSleepDayKeys(USER, DATE, DATE)).toEqual([DATE])
      await call('DELETE', { id })
      expect(await repo.listSleepSessions(USER, DATE, DATE)).toEqual([])
      expect(await repo.listSleepDayKeys(USER, DATE, DATE)).toEqual([])
      const delta = await repo.getSyncDelta(USER, new Date(0))
      const pulled = (delta.sleepSessions as { id: string; deletedAt: Date | null }[]).find(r => r.id === id)
      expect(pulled?.deletedAt).toBeInstanceOf(Date)
    })

    it('a removed night no longer counts for the sleep achievements', async () => {
      const { computeAchievements } = await import('@/lib/achievements')
      const sleepFirst = async () =>
        (await computeAchievements(USER, TZ)).achievements.find(a => a.id === 'sleep_first')?.current
      const { id } = await enter()
      expect(await sleepFirst()).toBe(1)
      await call('DELETE', { id })
      expect(await sleepFirst()).toBe(0)
    })

    it('a remembered bedtime cannot be put on a removed night', async () => {
      const { id } = await enter()
      await call('DELETE', { id })
      expect(await repo.setManualSleepStart(USER, DATE, new Date(BED))).toBe(false)
      expect((await pool.query(`SELECT manual_sleep_start FROM sleep_sessions WHERE id = $1`, [id])).rows[0].manual_sleep_start).toBeNull()
    })

    it('removing the typed night leaves the device night that shadowed it exactly as it was', async () => {
      const ring = await seedDevice('2026-10-06T13:10:00.000Z', '2026-10-06T20:05:00.000Z', 6.4)
      const { id } = await enter()
      const before = await repo.listSleepSessions(USER, DATE, DATE)
      expect(before.map(r => r.id)).toEqual([ring])
      await call('DELETE', { id })
      expect(await repo.listSleepSessions(USER, DATE, DATE)).toEqual(before)
    })
  })

  describe('entering a removed night again', () => {
    it('revives the removed row, id kept, when the same times are entered (they could never insert)', async () => {
      const { id } = await enter()
      await call('DELETE', { id })
      const again = await enter()
      expect(again).toMatchObject({ id, shadowed: false })
      const all = await rows()
      expect(all).toHaveLength(1)
      expect(all[0]).toMatchObject({ id, deleted_at: null, manual_entry: true })
      expect((await repo.listSleepSessions(USER, DATE, DATE)).map(r => r.id)).toEqual([id])
    })

    it('revives it with the new times when a different window is entered for that night', async () => {
      const { id } = await enter()
      await call('DELETE', { id })
      const again = await enter({ sleepStart: '2026-10-06T13:30:00.000Z', sleepEnd: WAKE })
      expect(again.id).toBe(id)
      const all = await rows()
      expect(all).toHaveLength(1)
      expect(all[0]).toMatchObject({ id, deleted_at: null, duration_hours: 7, sleep_start: new Date('2026-10-06T13:30:00.000Z') })
    })

    it('revives a removed night that started at the same instant even when it was filed under another date', async () => {
      const { id } = await enter()
      await call('DELETE', { id })
      // Same bed time, woken after midnight UTC+10 the next day — a different wake date.
      const again = await enter({ sleepStart: BED, sleepEnd: '2026-10-06T23:30:00.000Z' })
      expect(again.id).toBe(id)
      expect(await rows()).toEqual([expect.objectContaining({ id, date: DATE, deleted_at: null, duration_hours: 11 })])
    })

    it('the partial unique key holds live nights only: a removed night does not block a second row for its date', async () => {
      const { id } = await enter()
      await call('DELETE', { id })
      // Straight to the table, past the revive: the index allows it.
      await pool.query(
        `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, manual_entry)
         VALUES ($1,$2,'2026-10-06T14:00:00Z','2026-10-06T20:30:00Z',6.5,true)`, [USER, DATE])
      // …but two LIVE manual nights for one date are still refused.
      await expect(pool.query(
        `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, manual_entry)
         VALUES ($1,$2,'2026-10-06T14:30:00Z','2026-10-06T20:30:00Z',6,true)`, [USER, DATE])).rejects.toMatchObject({ code: '23505' })
      const { rows: [idx] } = await pool.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'sleep_sessions_manual_night_key'`)
      expect(idx.indexdef).toMatch(/WHERE \(manual_entry AND \(deleted_at IS NULL\)\)/)
    })

    it('with a live night and a removed one on the date, an entry edits the live one and leaves the removed one removed', async () => {
      const { id: removed } = await enter()
      await call('DELETE', { id: removed })
      const { rows: [{ id: live }] } = await pool.query(
        `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, manual_entry)
         VALUES ($1,$2,'2026-10-06T14:00:00Z','2026-10-06T20:30:00Z',6.5,true) RETURNING id`, [USER, DATE])
      expect((await enter({ sleepStart: '2026-10-06T13:30:00.000Z', sleepEnd: WAKE })).id).toBe(live)
      const all = await rows()
      expect(all.find(r => r.id === live)).toMatchObject({ deleted_at: null, duration_hours: 7 })
      expect(all.find(r => r.id === removed)).toMatchObject({ deleted_at: expect.any(Date), duration_hours: 8 })
    })
  })

  describe('the push branch removes what the route removes', () => {
    const LOCAL_ID = '6f1c2a4e-0b7d-4c1e-9a55-2606aa000001'
    const save = (id = 'm-save') => ({ id, domain: 'manual_sleep' as const, date: DATE, payload: { id: LOCAL_ID, sleepStart: BED, sleepEnd: WAKE } })
    const remove = (id = 'm-remove', nightId = LOCAL_ID) => ({ id, domain: 'manual_sleep' as const, date: DATE, payload: { id: nightId, deleted: true } })

    it('a save then a removal, in outbox order, leaves the night removed', async () => {
      const out = await repo.pushMutations(USER, [save(), remove()])
      expect(out.errors).toEqual([])
      expect(out.processed).toBe(2)
      expect(await rows()).toEqual([expect.objectContaining({ id: LOCAL_ID, deleted_at: expect.any(Date) })])
      expect(await repo.listSleepSessions(USER, DATE, DATE)).toEqual([])
    })

    it('a replayed batch (the reply was lost) ends removed too, and the replayed removal counts as processed', async () => {
      await repo.pushMutations(USER, [save(), remove()])
      const again = await repo.pushMutations(USER, [save('m-save-2'), remove('m-remove-2')])
      expect(again.errors).toEqual([])
      expect(again.processed).toBe(2)
      expect(await rows()).toEqual([expect.objectContaining({ id: LOCAL_ID, deleted_at: expect.any(Date) })])
    })

    it('an id with no row for this user is processed and changes nothing — another user\'s night included', async () => {
      auth.user = { id: OTHER, timezone: TZ }
      const theirs = await enter()
      const out = await repo.pushMutations(USER, [remove('m1', UNKNOWN), remove('m2', theirs.id)])
      expect(out.errors).toEqual([])
      expect(out.processed).toBe(2)
      expect((await rows(OTHER))[0]).toMatchObject({ id: theirs.id, deleted_at: null })
    })

    it('quarantines a removal aimed at a device night, and a malformed removal, without blocking the queue', async () => {
      const ring = await seedDevice('2026-10-06T13:10:00.000Z', '2026-10-06T20:05:00.000Z', 6.4)
      const out = await repo.pushMutations(USER, [
        remove('bad-device', ring),
        { id: 'bad-shape', domain: 'manual_sleep', date: DATE, payload: { id: 'nope', deleted: true } },
        save('good'),
      ])
      expect(out.errors.map((e: { id?: string }) => e.id)).toEqual(['bad-device', 'bad-shape'])
      expect(out.processed).toBe(1)
      expect((await rows()).find(r => r.id === ring)).toMatchObject({ manual_entry: false, deleted_at: null })
    })

    it('a fresh device id for a removed night revives the server\'s row under the server\'s id', async () => {
      await repo.pushMutations(USER, [save(), remove()])
      const fresh = '6f1c2a4e-0b7d-4c1e-9a55-2606aa000002'
      const out = await repo.pushMutations(USER, [{ ...save('m-again'), payload: { id: fresh, sleepStart: BED, sleepEnd: WAKE } }])
      expect(out.errors).toEqual([])
      expect(await rows()).toEqual([expect.objectContaining({ id: LOCAL_ID, deleted_at: null })])
    })
  })

  describe('device writes and a removed night', () => {
    it('a device night landing on a removed typed night\'s start becomes that device night, visible', async () => {
      const { id } = await enter()
      await call('DELETE', { id })
      await repo.saveSleepSession(USER, {
        date: DATE, sleepStart: new Date(BED), sleepEnd: new Date('2026-10-06T20:00:00.000Z'), durationHours: 7.2,
      }, 'health_connect')
      expect(await rows()).toEqual([expect.objectContaining({ id, manual_entry: false, deleted_at: null, duration_hours: 7.2 })])
      expect((await repo.listSleepSessions(USER, DATE, DATE)).map(r => [r.id, r.manualEntry])).toEqual([[id, false]])
    })

    it('the ring rollup\'s re-roll neither deletes nor revives a removed typed night', async () => {
      await seedDevice('2026-10-06T13:10:00.000Z', '2026-10-06T20:05:00.000Z', 6.4, 'ble:2606-r')
      const { id } = await enter()
      await call('DELETE', { id })
      const { createPostgresRollupIO } = await import('@/lib/data/postgres/rollup-io')
      const { getDb } = await import('@/lib/data/postgres/client')
      const io = createPostgresRollupIO({ db: getDb(), userId: USER } as never)
      // Issue 2546: the ring night the pass did not reproduce is tombstoned too, not deleted.
      await io.tombstoneBleSleepSessionsExcept([DATE], [])
      const after = await rows()
      expect(after.find(r => r.id === id)).toMatchObject({ manual_entry: true, deleted_at: expect.any(Date) })
      expect(after.filter(r => r.id !== id)).toEqual([expect.objectContaining({ manual_entry: false, deleted_at: expect.any(Date) })])
      // With the ring night gone, nothing is the night: the removed entry does not come back.
      expect(await repo.listSleepSessions(USER, DATE, DATE)).toEqual([])
      await io.upsertSleepSessions([{
        ouraId: 'ble:2606-r2', date: DATE, sleepStart: new Date('2026-10-06T13:15:00.000Z'),
        sleepEnd: new Date('2026-10-06T20:05:00.000Z'), durationHours: 6.3,
      }])
      expect((await repo.listSleepSessions(USER, DATE, DATE)).map(r => r.manualEntry)).toEqual([false])
      expect((await rows()).find(r => r.id === id)).toMatchObject({ deleted_at: expect.any(Date) })
    })
  })
})
