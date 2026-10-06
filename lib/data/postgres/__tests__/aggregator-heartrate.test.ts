// #2168 — Health Connect's heart-rate series in the shared HR table: the write half.
//
// Ingest architecture D2: when two sources cover the same interval, rank decides what the scores
// read and the loser is KEPT. The read half lives in `mergeHrSources` (its own tests, and the SQL
// mirror in `observed-hr-sql-equivalence.test.ts`). This file pins what the write may and may not
// do to rows already there — above all, that it can never displace a ring or strap row.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { fromZonedTime } from 'date-fns-tz'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000002168'
const OTHER = '00000000-0000-4000-8000-000000012168'
const TZ = 'Australia/Brisbane'

/** Local midday `daysAgo` days back — fixtures follow the clock and sit clear of any day boundary. */
const middayAgo = (daysAgo: number) => fromZonedTime(`${shiftDateStr(todayInTz(TZ), -daysAgo)}T12:00:00`, TZ)

describe.skipIf(!canRun)('upsertAggregatorHeartrate', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let oura: typeof import('@/lib/data/postgres/slices/oura')

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    db = client.getDb()
    oura = await import('@/lib/data/postgres/slices/oura')
    for (const [id, tag] of [[USER, 'owner'], [OTHER, 'other']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, name, timezone) VALUES ($1, $2, 'HC HR', $3) ON CONFLICT (id) DO NOTHING`,
        [id, `hc-hr-2168-${tag}@local.dev`, TZ])
    }
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM daily_zone_minutes WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM daily_zone_minutes WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = ANY($1)`, [[USER, OTHER]])
  })

  const rowsFor = async (userId = USER) => (await pool.query<{ ts: Date; bpm: number; source: string | null }>(
    `SELECT timestamp AS ts, bpm, source FROM oura_heartrate WHERE user_id = $1 ORDER BY timestamp`, [userId],
  )).rows

  it('lands a non-null bpm in the column, stamped with its source', async () => {
    const t = middayAgo(1)
    await oura.upsertAggregatorHeartrate(db, USER, [{ timestamp: t, bpm: 74 }], 'health_connect', TZ)
    expect(await rowsFor()).toEqual([{ ts: t, bpm: 74, source: 'health_connect' }])
  })

  it('never displaces a ring or strap row that already holds the same timestamp', async () => {
    const t1 = middayAgo(1)
    const t2 = new Date(t1.getTime() + 1000)
    await oura.upsertOuraHeartrate(db, USER, [
      { timestamp: t1, bpm: 61, source: 'ble' },
      { timestamp: t2, bpm: 118, source: 'chest_strap' },
    ])
    await oura.upsertAggregatorHeartrate(db, USER, [{ timestamp: t1, bpm: 150 }, { timestamp: t2, bpm: 151 }], 'health_connect', TZ)
    expect(await rowsFor()).toEqual([
      { ts: t1, bpm: 61, source: 'ble' },
      { ts: t2, bpm: 118, source: 'chest_strap' },
    ])
  })

  it('updates its own row on a re-sync, so a corrected sample is not stuck', async () => {
    const t = middayAgo(1)
    await oura.upsertAggregatorHeartrate(db, USER, [{ timestamp: t, bpm: 70 }], 'health_connect', TZ)
    await oura.upsertAggregatorHeartrate(db, USER, [{ timestamp: t, bpm: 76 }], 'health_connect', TZ)
    expect(await rowsFor()).toEqual([{ ts: t, bpm: 76, source: 'health_connect' }])
  })

  it('gives the slot to a ring row that arrives later, so the order of arrival does not matter', async () => {
    const t = middayAgo(1)
    await oura.upsertAggregatorHeartrate(db, USER, [{ timestamp: t, bpm: 150 }], 'health_connect', TZ)
    await oura.upsertOuraHeartrate(db, USER, [{ timestamp: t, bpm: 61, source: 'ble' }])
    expect(await rowsFor()).toEqual([{ ts: t, bpm: 61, source: 'ble' }])
  })

  it('keeps a Health Connect row beside a ring row a second away — stored, just not read', async () => {
    const t = middayAgo(1)
    await oura.upsertOuraHeartrate(db, USER, [{ timestamp: t, bpm: 61, source: 'ble' }])
    await oura.upsertAggregatorHeartrate(db, USER, [{ timestamp: new Date(t.getTime() + 1000), bpm: 150 }], 'health_connect', TZ)

    expect((await rowsFor()).map(r => r.source)).toEqual(['ble', 'health_connect'])
    const read = await oura.getHrForWindow(db, USER, new Date(t.getTime() - 60_000), new Date(t.getTime() + 60_000))
    expect(read.map(r => r.source)).toEqual(['ble'])
  })

  it('writes only the calling user, whatever the other user holds at the same instant', async () => {
    const t = middayAgo(1)
    await oura.upsertAggregatorHeartrate(db, OTHER, [{ timestamp: t, bpm: 90 }], 'health_connect', TZ)
    await oura.upsertAggregatorHeartrate(db, USER, [{ timestamp: t, bpm: 70 }], 'health_connect', TZ)
    expect(await rowsFor(OTHER)).toEqual([{ ts: t, bpm: 90, source: 'health_connect' }])
    expect(await rowsFor(USER)).toEqual([{ ts: t, bpm: 70, source: 'health_connect' }])
  })

  it('drops the cached zone-minute days from the earliest sample on, and only those', async () => {
    const days = [3, 2, 1, 0].map(n => shiftDateStr(todayInTz(TZ), -n))
    for (const userId of [USER, OTHER]) {
      for (const day of days) {
        await pool.query(`INSERT INTO daily_zone_minutes (user_id, day, zone2_sec) VALUES ($1, $2, 600)`, [userId, day])
      }
    }
    await oura.upsertAggregatorHeartrate(db, USER, [
      { timestamp: middayAgo(0), bpm: 120 },
      { timestamp: middayAgo(2), bpm: 121 },
    ], 'health_connect', TZ)

    const left = async (userId: string) => (await pool.query<{ day: string }>(
      `SELECT day::text AS day FROM daily_zone_minutes WHERE user_id = $1 ORDER BY day`, [userId])).rows.map(r => r.day)
    expect(await left(USER)).toEqual([days[0]])
    expect(await left(OTHER)).toEqual(days)
  })

  it('refuses a device source — a ring or strap write goes through upsertOuraHeartrate', async () => {
    await expect(oura.upsertAggregatorHeartrate(db, USER, [{ timestamp: middayAgo(1), bpm: 70 }], 'oura_ble', TZ))
      .rejects.toThrow(/not an aggregator source/)
    expect(await rowsFor()).toEqual([])
  })
})
