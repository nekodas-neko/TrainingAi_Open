// #3850. A past day's cached zone minutes depend on the workouts and activity logs that fall on it
// (#3775: inside one, a heart-rate gap counts up to 5½ min, elsewhere up to 2). So a workout or log
// that reaches the server after the day was cached must drop that day, and a row computed before the
// rule (`ZONE_RULE_EFFECTIVE_AT`) is recomputed while its heart rate is still kept. DB-backed: runs in
// CI and the local sandbox, skipped otherwise.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { fromZonedTime } from 'date-fns-tz'
import { txBackendPid, waitUntilBlockedBy } from './helpers/lock-wait'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003850'
const TZ = 'Australia/Brisbane'
const PROFILE = { maxHr: 190, restingHr: 60 }

describe('zoneDaysOfSession / zoneDaysOfActivityDate (#3850)', () => {
  it('a session moves every local day its span touches, and an unfinished one moves none', async () => {
    const { zoneDaysOfSession } = await import('@/lib/data/postgres/slices/oura')
    const start = fromZonedTime('2026-11-10T23:40:00', TZ)
    expect(zoneDaysOfSession(start, fromZonedTime('2026-11-11T00:30:00', TZ), TZ)).toEqual(['2026-11-10', '2026-11-11'])
    expect(zoneDaysOfSession(start, fromZonedTime('2026-11-10T23:55:00', TZ), TZ)).toEqual(['2026-11-10'])
    expect(zoneDaysOfSession(start, null, TZ)).toEqual([])
  })

  it('an activity log moves its own day and the next (the reader looks one day back)', async () => {
    const { zoneDaysOfActivityDate } = await import('@/lib/data/postgres/slices/oura')
    expect(zoneDaysOfActivityDate('2026-11-30')).toEqual(['2026-11-30', '2026-12-01'])
  })
})

describe.skipIf(!canRun)('cached zone minutes follow workouts written later, and the rule date (#3850)', () => {
  let pool: import('pg').Pool
  let repo: Awaited<ReturnType<typeof import('@/lib/data').getRepository>>
  let today: string, day: string, cutoff: string
  let shift: (d: string, n: number) => string

  const total = async (d: string) => {
    const days = await repo.getZoneMinutesRange(USER, d, d, TZ, PROFILE)
    return days.find(x => x.day === d)?.seconds.reduce((a, b) => a + b, 0) ?? null
  }
  const cachedRow = async (d: string) => (await pool.query(
    `SELECT zone2_sec, max_hr, computed_at FROM daily_zone_minutes WHERE user_id = $1 AND day = $2`, [USER, d],
  )).rows[0] as { zone2_sec: number; max_hr: number | null; computed_at: Date } | undefined
  // #3862: a writer marks the day stale (max_hr NULL, which no profile matches) instead of deleting it.
  const stale = async (d: string) => (await cachedRow(d))?.max_hr === null
  const at = (d: string, hhmm: string) => fromZonedTime(`${d}T${hhmm}:00`, TZ)

  // Readings every 4 min, 08:00 to 08:40, at a Zone 2-ish 130 bpm: outside a window each gap counts
  // 2 min, inside one all 4.
  async function seedHr(d: string) {
    const base = at(d, '08:00').getTime()
    const params: unknown[] = [USER]
    const rows: string[] = []
    for (let i = 0; i <= 10; i++) {
      params.push(new Date(base + i * 4 * 60_000).toISOString(), 130)
      rows.push(`($1, $${params.length - 1}, $${params.length}, 'ble')`)
    }
    await pool.query(
      `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source) VALUES ${rows.join(',')}
       ON CONFLICT (user_id, timestamp) DO NOTHING`, params)
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    const { todayInTz, shiftDateStr } = await import('@trainingai/shared/date-utils')
    const { zoneRetentionCutoff } = await import('@/lib/data/postgres/slices/oura')
    pool = getPool()
    repo = await getRepository()
    shift = shiftDateStr
    today = todayInTz(TZ)
    day = shiftDateStr(today, -3)
    cutoff = zoneRetentionCutoff(today)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [USER, `zone-3850-${USER}@example.com`, TZ])
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [USER])
    await seedHr(day)
    await seedHr(today)
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM daily_zone_minutes WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM activity_logs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
  })

  it('an activity log saved after its day was cached lifts that day, and deleting it lowers it again', async () => {
    const without = await total(day)
    expect(without).toBeGreaterThan(0)
    expect(await cachedRow(day)).toBeDefined()

    const log = await repo.saveActivityLog(USER, {
      date: day, activityType: 'other', title: 'Walk', startTime: '08:00', endTime: '08:40', durationMin: 40,
    })
    expect(await stale(day)).toBe(true)
    const withLog = await total(day)
    expect(withLog).toBeGreaterThan(without!)

    await repo.deleteActivityLog(USER, log.id)
    expect(await total(day)).toBe(without)
  })

  it('an outbox edit that moves a log to another date drops the day it left', async () => {
    // A timed log: before #3859 this move hit the primary key and never reached this code.
    const log = await repo.saveActivityLog(USER, { date: day, activityType: 'other', title: 'Walk', startTime: '08:00', durationMin: 40 })
    // The save marked the day; cache it again as current before the move.
    await pool.query(
      `INSERT INTO daily_zone_minutes (user_id, day, zone2_sec, max_hr, resting_hr) VALUES ($1, $2, 1, 190, 60)
       ON CONFLICT (user_id, day) DO UPDATE SET zone2_sec = 1, max_hr = 190, resting_hr = 60`, [USER, day])
    await repo.saveActivityLog(USER, {
      id: log.id, date: shift(day, -5), activityType: 'other', title: 'Walk', startTime: '08:00', durationMin: 40,
    }, { overwrite: true })
    expect(await stale(day)).toBe(true)
  })

  it('a workout completed after its day was cached lifts that day, and its tombstone lowers it', async () => {
    const without = await total(day)
    const ws = await repo.createWorkoutSession(USER, undefined, 'Session', at(day, '08:00'))
    // Started but not finished: no window yet, so the cache is still right.
    expect(await stale(day)).toBe(false)
    expect(await repo.completeWorkoutSession(ws.id, USER, at(day, '08:40'))).toBe(true)
    expect(await stale(day)).toBe(true)
    expect(await total(day)).toBeGreaterThan(without!)

    const { deleteWorkoutSessionAndReconcile } = await import('@/lib/workout/delete-session-reconcile')
    await deleteWorkoutSessionAndReconcile(USER, ws.id)
    expect(await total(day)).toBe(without)
  })

  it('a session that crosses midnight drops both days', async () => {
    const next = shift(day, 1)
    await pool.query(
      `INSERT INTO daily_zone_minutes (user_id, day, zone2_sec, max_hr, resting_hr) VALUES ($1, $2, 1, 190, 60), ($1, $3, 1, 190, 60)`,
      [USER, day, next])
    const ws = await repo.createWorkoutSession(USER, undefined, 'Late', at(day, '23:30'))
    await repo.completeWorkoutSession(ws.id, USER, at(next, '00:20'))
    expect(await stale(day)).toBe(true)
    expect(await stale(next)).toBe(true)
  })

  it('a row cached before ZONE_RULE_EFFECTIVE_AT inside retention is recomputed and restamped', async () => {
    const { ZONE_RULE_EFFECTIVE_AT } = await import('@/lib/data/postgres/slices/oura')
    const old = new Date(ZONE_RULE_EFFECTIVE_AT.getTime() - 86_400_000)
    await pool.query(
      `INSERT INTO daily_zone_minutes (user_id, day, zone2_sec, max_hr, resting_hr, computed_at) VALUES ($1, $2, 1, 190, 60, $3)`,
      [USER, day, old])
    const got = await total(day)
    expect(got).not.toBe(1)
    const row = await cachedRow(day)
    // Restamped. The constant is set a little late on purpose, so until it passes the next read
    // recomputes again (and gets the same answer); after it, the restamped row is trusted.
    expect(row!.computed_at.getTime()).not.toBe(old.getTime())
    expect(await total(day)).toBe(got)
  })

  it('a row computed under the current rule with a matching profile is served as stored', async () => {
    const { ZONE_RULE_EFFECTIVE_AT } = await import('@/lib/data/postgres/slices/oura')
    await pool.query(
      `INSERT INTO daily_zone_minutes (user_id, day, zone2_sec, max_hr, resting_hr, computed_at) VALUES ($1, $2, 7, 190, 60, $3)`,
      [USER, day, new Date(ZONE_RULE_EFFECTIVE_AT.getTime() + 3_600_000)])
    expect(await total(day)).toBe(7)
  })

  it('a row past retention computed before the rule is the frozen record, served unchanged', async () => {
    const { ZONE_RULE_EFFECTIVE_AT } = await import('@/lib/data/postgres/slices/oura')
    const frozen = shift(cutoff, -5)
    await pool.query(
      `INSERT INTO daily_zone_minutes (user_id, day, zone2_sec, max_hr, resting_hr, computed_at) VALUES ($1, $2, 600, 190, 60, $3)`,
      [USER, frozen, new Date(ZONE_RULE_EFFECTIVE_AT.getTime() - 86_400_000)])
    const days = await repo.getZoneMinutesRange(USER, frozen, frozen, TZ, PROFILE)
    expect(days).toEqual([{ day: frozen, seconds: [0, 600, 0, 0, 0] }])
  })

  it('a write never drops a day past retention', async () => {
    const frozen = shift(cutoff, -5)
    await pool.query(
      `INSERT INTO daily_zone_minutes (user_id, day, zone2_sec, max_hr, resting_hr) VALUES ($1, $2, 600, 190, 60)`, [USER, frozen])
    await repo.saveActivityLog(USER, {
      date: frozen, activityType: 'other', title: 'Walk', startTime: '08:00', endTime: '08:40', durationMin: 40,
    })
    expect(await cachedRow(frozen)).toMatchObject({ zone2_sec: 600, max_hr: 190 })
  })

  it('today is still always recomputed, whatever is cached for it', async () => {
    await pool.query(
      `INSERT INTO daily_zone_minutes (user_id, day, zone2_sec, max_hr, resting_hr) VALUES ($1, $2, 1, 190, 60)`, [USER, today])
    // The seeded readings are stored whatever the clock says, so today has heart rate to count.
    const got = await total(today)
    expect(got).toBeGreaterThan(1)
    expect((await cachedRow(today))!.zone2_sec).toBe(1)
  })
  // #3862 item 1. The race: a read loads the day's windows, a write lands and marks the day stale,
  // and the read then writes its value back. The write runs in a transaction held open across the
  // read, so the read's snapshot cannot see the new log (the stale input) and its write-back has to
  // wait on the marker's row lock, which is the interleaving at its tightest.
  async function raceAWrite(seedCachedRow: boolean) {
    const { getDb } = await import('@/lib/data/postgres/client')
    const { markZoneMinutesStale } = await import('@/lib/data/postgres/slices/oura')
    const s = await import('@/lib/data/postgres/schema')
    const without = seedCachedRow ? await total(day) : null
    expect(!!(await cachedRow(day))).toBe(seedCachedRow)
    // A cached row that matches the profile is served from the read's snapshot with no write-back,
    // so nothing would race. Drift its profile so the read recomputes and its conditional write-back
    // meets the marker (#3929: the unscoped probe hid that this case never blocked).
    if (seedCachedRow) {
      await pool.query(`UPDATE daily_zone_minutes SET max_hr = max_hr - 10 WHERE user_id = $1 AND day = $2`, [USER, day])
    }
    let read: Promise<unknown> | undefined
    await getDb().transaction(async tx => {
      await tx.insert(s.activityLogs).values({
        userId: USER, date: day, activityType: 'other', title: 'Walk', startTime: '08:00', endTime: '08:40', durationMin: 40,
      })
      await markZoneMinutesStale(tx, USER, [day], TZ)
      // The read starts while the write is uncommitted: it sees no log, and its write-back blocks.
      // Wait for a backend blocked by this transaction itself, not any lock wait on the database:
      // another session's wait would end the loop before the read has loaded its windows (#3929).
      const holder = await txBackendPid(tx)
      read = total(day)
      await waitUntilBlockedBy(pool, holder)
    })
    const raced = await read
    return { without, raced }
  }

  it('a read that loaded its windows before a write does not cache its stale value over the marker', async () => {
    const { without, raced } = await raceAWrite(true)
    expect(without).toBeGreaterThan(0)
    // The read answered from what it loaded, the day without the log...
    expect(raced).toBe(without)
    // ...but did not write it back: the day is still marked, so the next read recomputes with the log.
    expect(await stale(day)).toBe(true)
    const next = await total(day)
    expect(next).toBeGreaterThan(raced as number)
    expect(await stale(day)).toBe(false)
  })

  it('the same holds for a day not cached yet: the read does not insert over the new marker', async () => {
    const { without, raced } = await raceAWrite(false)
    expect(without).toBeNull()
    expect(raced).toBeGreaterThan(0)
    expect(await stale(day)).toBe(true)
    expect(await total(day)).toBeGreaterThan(raced as number)
  })

  // #3862 item 3: a push collects its drops and writes them once, after every mutation in it.
  it('a push of several activity logs marks every day they touch once, after all of them are written', async () => {
    const { randomUUID } = await import('crypto')
    const other = shift(day, -2)
    for (const d of [day, other]) {
      await pool.query(
        `INSERT INTO daily_zone_minutes (user_id, day, zone2_sec, max_hr, resting_hr) VALUES ($1, $2, 1, 190, 60)`, [USER, d])
    }
    const log = (d: string, hhmm: string) => ({
      domain: 'activity_logs' as const, date: d,
      payload: { id: randomUUID(), activityType: 'other', title: 'Walk', startTime: hhmm, durationMin: 40 },
    })
    const result = await repo.pushMutations(USER, [log(day, '08:00'), log(other, '09:00')])
    expect(result.errors).toEqual([])
    expect(result.processed).toBe(2)
    for (const d of [day, other, shift(day, 1), shift(other, 1)]) expect(await stale(d)).toBe(true)
    const { rows } = await pool.query(
      `SELECT (SELECT min(computed_at) FROM daily_zone_minutes WHERE user_id = $1)
            > (SELECT max(created_at) FROM activity_logs WHERE user_id = $1) AS after`, [USER])
    expect(rows[0].after).toBe(true)
  })

  // #3862 item 2. The HR prune cuts at now() − 180 d, so the day today − 180 has lost its morning.
  describe('the partly pruned retention day', () => {
    let edge: string
    beforeAll(async () => {
      edge = shift(today, -180)
      await seedHr(edge)
    })

    it('counts as past retention', () => {
      expect(edge < cutoff).toBe(true)
      expect(shift(edge, 1)).toBe(cutoff)
    })

    it('a row there under a drifted profile is served as stored, not recomputed from part of the day', async () => {
      await pool.query(
        `INSERT INTO daily_zone_minutes (user_id, day, zone2_sec, max_hr, resting_hr) VALUES ($1, $2, 600, 180, 55)`, [USER, edge])
      expect(await repo.getZoneMinutesRange(USER, edge, edge, TZ, PROFILE)).toEqual([{ day: edge, seconds: [0, 600, 0, 0, 0] }])
      expect(await cachedRow(edge)).toMatchObject({ zone2_sec: 600, max_hr: 180 })
    })

    it('a write does not mark it', async () => {
      await pool.query(
        `INSERT INTO daily_zone_minutes (user_id, day, zone2_sec, max_hr, resting_hr) VALUES ($1, $2, 600, 190, 60)`, [USER, edge])
      await repo.saveActivityLog(USER, {
        date: shift(edge, -1), activityType: 'other', title: 'Walk', startTime: '08:00', endTime: '08:40', durationMin: 40,
      })
      expect(await cachedRow(edge)).toMatchObject({ zone2_sec: 600, max_hr: 190 })
    })

    it('an uncached day there is never stamped as final', async () => {
      const got = await total(edge)
      expect(got).toBeGreaterThan(0)
      expect(await cachedRow(edge)).toBeUndefined()
    })

    it('the first day inside retention is still marked and cached as before', async () => {
      await seedHr(cutoff)
      expect(await total(cutoff)).toBeGreaterThan(0)
      expect(await stale(cutoff)).toBe(false)
      await repo.saveActivityLog(USER, {
        date: cutoff, activityType: 'other', title: 'Walk', startTime: '08:00', endTime: '08:40', durationMin: 40,
      })
      expect(await stale(cutoff)).toBe(true)
    })
  })
})
