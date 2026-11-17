// #3850. A past day's cached zone minutes depend on the workouts and activity logs that fall on it
// (#3775: inside one, a heart-rate gap counts up to 5½ min, elsewhere up to 2). So a workout or log
// that reaches the server after the day was cached must drop that day, and a row computed before the
// rule (`ZONE_RULE_EFFECTIVE_AT`) is recomputed while its heart rate is still kept. DB-backed: runs in
// CI and the local sandbox, skipped otherwise.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { fromZonedTime } from 'date-fns-tz'

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
    `SELECT zone2_sec, computed_at FROM daily_zone_minutes WHERE user_id = $1 AND day = $2`, [USER, d],
  )).rows[0] as { zone2_sec: number; computed_at: Date } | undefined
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
    expect(await cachedRow(day)).toBeUndefined()
    const withLog = await total(day)
    expect(withLog).toBeGreaterThan(without!)

    await repo.deleteActivityLog(USER, log.id)
    expect(await total(day)).toBe(without)
  })

  it('an outbox edit that moves a log to another date drops the day it left', async () => {
    // A timed log: before #3859 this move hit the primary key and never reached this code.
    const log = await repo.saveActivityLog(USER, { date: day, activityType: 'other', title: 'Walk', startTime: '08:00', durationMin: 40 })
    await pool.query(
      `INSERT INTO daily_zone_minutes (user_id, day, zone2_sec, max_hr, resting_hr) VALUES ($1, $2, 1, 190, 60)`, [USER, day])
    await repo.saveActivityLog(USER, {
      id: log.id, date: shift(day, -5), activityType: 'other', title: 'Walk', startTime: '08:00', durationMin: 40,
    }, { overwrite: true })
    expect(await cachedRow(day)).toBeUndefined()
  })

  it('a workout completed after its day was cached lifts that day, and its tombstone lowers it', async () => {
    const without = await total(day)
    const ws = await repo.createWorkoutSession(USER, undefined, 'Session', at(day, '08:00'))
    // Started but not finished: no window yet, so the cache is still right.
    expect(await cachedRow(day)).toBeDefined()
    expect(await repo.completeWorkoutSession(ws.id, USER, at(day, '08:40'))).toBe(true)
    expect(await cachedRow(day)).toBeUndefined()
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
    expect(await cachedRow(day)).toBeUndefined()
    expect(await cachedRow(next)).toBeUndefined()
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
    expect(await cachedRow(frozen)).toBeDefined()
  })

  it('today is still always recomputed, whatever is cached for it', async () => {
    await pool.query(
      `INSERT INTO daily_zone_minutes (user_id, day, zone2_sec, max_hr, resting_hr) VALUES ($1, $2, 1, 190, 60)`, [USER, today])
    // The seeded readings are stored whatever the clock says, so today has heart rate to count.
    const got = await total(today)
    expect(got).toBeGreaterThan(1)
    expect((await cachedRow(today))!.zone2_sec).toBe(1)
  })
})
