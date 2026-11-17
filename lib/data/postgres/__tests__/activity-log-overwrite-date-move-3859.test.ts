// #3859. The outbox replay of an activity-log edit (`saveActivityLog(..., { overwrite: true })`,
// reached through `pushMutations`) upserted on the natural key (user, date, start_time). An edit that
// kept the id and moved the date found no conflict there, so the insert hit the primary key and the
// mutation dead-lettered. An existing id now updates by id, ownership-checked; a move onto another
// row's minute is refused rather than merged. DB-backed: skips without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003859'
const OTHER = '00000000-0000-4000-8000-000000013859'

describe.skipIf(!canRun)('outbox edit that moves a timed activity log to another date (#3859)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const DAY = '2026-11-10'
  const MOVED = '2026-11-05'
  const payload = (id: string, title = 'Walk') => ({
    id, activityType: 'walk', title, startTime: '08:00', durationMin: 40,
  })
  const push = (date: string, p: Record<string, unknown>, outboxId = randomUUID()) =>
    repo.pushMutations(USER, [{ id: outboxId, domain: 'activity_logs', date, payload: p }])
  const rows = async (user = USER) => (await pool.query(
    `SELECT id, date::text AS date, to_char(start_time, 'HH24:MI') AS "startTime", title, deleted_at IS NOT NULL AS deleted
       FROM activity_logs WHERE user_id = $1 ORDER BY date, id`, [user],
  )).rows
  const cacheDays = async () => (await pool.query(
    // The days still trusted: a drop marks a day stale (max_hr NULL, #3862) rather than deleting it.
    `SELECT day::text AS day FROM daily_zone_minutes WHERE user_id = $1 AND max_hr IS NOT NULL ORDER BY day`, [USER],
  )).rows.map(r => r.day as string)
  const seedCache = async (...days: string[]) => {
    for (const d of days) {
      await pool.query(
        `INSERT INTO daily_zone_minutes (user_id, day, zone2_sec, max_hr, resting_hr) VALUES ($1, $2, 1, 190, 60)
         ON CONFLICT DO NOTHING`, [USER, d])
    }
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const u of [USER, OTHER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [u, `al-3859-${u}@example.com`])
    }
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM activity_logs WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(`DELETE FROM daily_zone_minutes WHERE user_id = $1`, [USER])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM activity_logs WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(`DELETE FROM daily_zone_minutes WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]])
  })

  it('moves a timed log to another date, keeping its id, and drops both days from the cache', async () => {
    const id = randomUUID()
    expect((await push(DAY, payload(id))).errors).toEqual([])
    await seedCache(DAY, MOVED)

    const result = await push(MOVED, payload(id, 'Moved walk'))
    expect(result.errors).toEqual([])
    expect(result.processed).toBe(1)
    expect(await rows()).toEqual([{ id, date: MOVED, startTime: '08:00', title: 'Moved walk', deleted: false }])
    // #3850: the day it left and the day it landed on are both recomputed.
    expect(await cacheDays()).toEqual([])
  })

  it('an untimed log moves too (its id-keyed upsert never set the date)', async () => {
    const id = randomUUID()
    const untimed = { id, activityType: 'walk', title: 'Walk', durationMin: 40 }
    await push(DAY, untimed)
    expect((await push(MOVED, untimed)).errors).toEqual([])
    expect((await rows()).map(r => [r.id, r.date])).toEqual([[id, MOVED]])
  })

  it('replaying the same move twice is idempotent', async () => {
    const id = randomUUID()
    await push(DAY, payload(id))
    const outboxId = randomUUID()
    expect((await push(MOVED, payload(id), outboxId)).errors).toEqual([])
    expect((await push(MOVED, payload(id), outboxId)).errors).toEqual([])
    expect(await rows()).toEqual([{ id, date: MOVED, startTime: '08:00', title: 'Walk', deleted: false }])
  })

  it('a new id still inserts, and still merges onto a same-minute row through the natural key', async () => {
    const first = randomUUID()
    expect((await push(DAY, payload(first))).errors).toEqual([])
    expect(await rows()).toEqual([{ id: first, date: DAY, startTime: '08:00', title: 'Walk', deleted: false }])
    // A different new id at the same minute keeps the DV-19 / #3044 merge behaviour.
    expect((await push(DAY, payload(randomUUID(), 'Merged'))).errors).toEqual([])
    expect(await rows()).toEqual([{ id: first, date: DAY, startTime: '08:00', title: 'Merged', deleted: false }])
  })

  it('refuses a move onto the minute of a different existing row, and changes neither', async () => {
    const mover = randomUUID()
    const sitter = randomUUID()
    await push(DAY, payload(mover, 'Mover'))
    await push(MOVED, payload(sitter, 'Sitter'))

    const result = await push(MOVED, payload(mover, 'Mover'))
    expect(result.processed).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toMatch(/already logged/)
    // A refusal is about the mutation, not the database: it must not retry forever.
    expect(result.errors[0].retryable).toBeUndefined()
    expect((await rows()).map(r => [r.id, r.date, r.title])).toEqual([
      [sitter, MOVED, 'Sitter'],
      [mover, DAY, 'Mover'],
    ])
  })

  it('a deleted row on that minute also refuses the move, and the edited row stays put', async () => {
    const mover = randomUUID()
    const gone = randomUUID()
    await push(DAY, payload(mover))
    await push(MOVED, payload(gone))
    await repo.deleteActivityLog(USER, gone)
    expect((await push(MOVED, payload(mover))).errors).toHaveLength(1)
    expect((await rows()).find(r => r.id === mover)?.date).toBe(DAY)
  })

  it('an edit to a deleted log keeps it deleted (delete still wins over a stale edit)', async () => {
    const id = randomUUID()
    await push(DAY, payload(id))
    await repo.deleteActivityLog(USER, id)
    expect((await push(MOVED, payload(id))).errors).toEqual([])
    expect(await rows()).toEqual([{ id, date: MOVED, startTime: '08:00', title: 'Walk', deleted: true }])
  })

  it("refuses another user's id and leaves their row untouched", async () => {
    const theirs = randomUUID()
    await repo.pushMutations(OTHER, [{ id: randomUUID(), domain: 'activity_logs', date: DAY, payload: payload(theirs, 'Theirs') }])

    for (const p of [payload(theirs, 'Hijack'), { id: theirs, activityType: 'walk', title: 'Hijack', durationMin: 40 }]) {
      const result = await push(MOVED, p)
      expect(result.processed).toBe(0)
      expect(result.errors[0].error).toMatch(/not found/)
    }
    expect(await rows(OTHER)).toEqual([{ id: theirs, date: DAY, startTime: '08:00', title: 'Theirs', deleted: false }])
    expect(await rows()).toEqual([])
  })
})
