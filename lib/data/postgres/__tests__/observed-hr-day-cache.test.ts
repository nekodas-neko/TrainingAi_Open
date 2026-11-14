// #3774 — the observed heart-rate profile with the part of its window before the user's local
// midnight kept for the day (`getObservedHrProfileForDay`) against the direct 90-day query
// (`getObservedHrProfile`).
//
// **The two must agree exactly**, because the profile sets the heart-rate zone boundaries. So, as
// in `observed-hr-sql-equivalence.test.ts`, every case runs both over the same rows and compares
// field for field; nothing states a hand-written expected profile.
//
// The fixture is built where the split could go wrong: three sources, with rows whose merge
// decision is made by a row on the other side of local midnight, in a zone that is not a whole
// number of hours from UTC. "Now" is the window's `to`, passed in, so the cases walk through a day
// and across a day change on any clock; every fixture instant is derived from the user's local
// midday today, never written down.
//
// Runs only against a real local dev Postgres.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr, toAestDay, todayInTz } from '@trainingai/shared/date-utils'
import { OBSERVED_WINDOW_DAYS } from '@trainingai/shared/health/hr-profile'
import { AGGREGATOR_COVER_MS } from '@trainingai/shared/health/hr-window-merge'
import {
  MAX_AGE_MS, MAX_ENTRIES, MERGE_SEAM_MS, closedObservedCounts, dropObservedHrDay, observedHrDayCacheEnabled,
  observedHrDayCacheSize, observedHrQueryCounts, setObservedHrDayCacheEnabled, splitObservedWindow,
} from '@/lib/data/postgres/observed-hr-day-cache'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000a774'
/** UTC+5:30, no daylight saving: local midnight is not on a UTC hour. */
const TZ = 'Asia/Kolkata'
const MIN = 60_000
const HOUR = 60 * MIN

const TODAY = todayInTz(TZ)
const MIDNIGHT = dateStrMidnightInTz(TODAY, TZ).getTime()
const MIDDAY = MIDNIGHT + 12 * HOUR
/** The profile's own window start for a "now" of `to`: local midnight 90 days before its date. */
const fromFor = (to: Date) => dateStrMidnightInTz(shiftDateStr(toAestDay(to, TZ), -OBSERVED_WINDOW_DAYS), TZ)

type Row = { at: Date; bpm: number; source: string | null }
const row = (ms: number, bpm: number, source: string | null): Row => ({ at: new Date(ms), bpm, source })

/** Three days of ring readings every five minutes with a daily hard hour, a strap over part of it,
 *  Health Connect across the lot, and a cluster of rows decided across midnight. */
function fixture(): Row[] {
  const rows: Row[] = []
  for (let t = MIDDAY - 60 * HOUR; t <= MIDDAY + 11.9 * HOUR; t += 5 * MIN) {
    const i = Math.round((t - MIDDAY) / (5 * MIN))
    const hard = ((i % 288) + 288) % 288 < 12
    rows.push(row(t, hard ? 150 + (Math.abs(i) % 31) : 52 + (Math.abs(i) % 23), 'ble'))
  }
  // A strap over one of yesterday's hard hours and one of today's: each shares a 10-second bucket
  // with a ring row (which then yields) and adds readings between them.
  for (const start of [MIDDAY - 24 * HOUR, MIDDAY]) {
    for (let t = start + 1000; t < start + 40 * MIN; t += 15_000) rows.push(row(t, 160 + ((t / 15_000) % 25), 'chest_strap'))
  }
  // Health Connect: most of it within five minutes of a device row (so it yields), and a stretch
  // four days back where no device row exists (so it is read).
  for (let t = MIDDAY - 60 * HOUR + 90_000; t <= MIDDAY + 11 * HOUR; t += 30 * MIN) rows.push(row(t, 95, 'health_connect'))
  for (let t = MIDDAY - 100 * HOUR; t < MIDDAY - 90 * HOUR; t += 10 * MIN) rows.push(row(t, 88 + ((t / (10 * MIN)) % 9), 'health_connect'))
  // Out-of-band readings on both sides of midnight.
  rows.push(row(MIDNIGHT - 7 * HOUR + 1234, 0, 'ble'), row(MIDNIGHT + 3 * HOUR + 1234, 255, 'ble'))
  return rows
}

const YESTERDAY_MIDNIGHT = MIDNIGHT - 24 * HOUR
/**
 * Rows around today's and yesterday's midnights. The regular ring rows there are removed first, so
 * each Health Connect row's only possible cover is the one named. A bpm above 215 is higher than
 * anything else in the fixture, so a row wrongly read moves the maximum.
 */
function seamRows(): Row[] {
  return [
    // Today. The only device row within five minutes of any of these is 20 s AFTER midnight.
    row(MIDNIGHT + 20_000, 61, 'ble'),
    row(MIDNIGHT - 2 * MIN, 219, 'health_connect'),      // yields to it
    row(MIDNIGHT - 270_000, 219, 'health_connect'),      // yields to it from 290 s away, inside the last five minutes
    row(MIDNIGHT - 7 * MIN, 216, 'health_connect'),      // out of its reach, in the kept part: read
    // Yesterday. A row one second inside the kept part, covered by a ring row 299 s later and still
    // before midnight; and a ring row yielding to a strap in the last 10-second bucket of the day
    // and in the first of the next.
    row(YESTERDAY_MIDNIGHT - MERGE_SEAM_MS - 1000, 219, 'health_connect'), row(YESTERDAY_MIDNIGHT - 2000, 63, 'ble'),
    row(YESTERDAY_MIDNIGHT - 4000, 217, 'ble'), row(YESTERDAY_MIDNIGHT - 9000, 64, 'chest_strap'),
    row(YESTERDAY_MIDNIGHT + 3000, 217, 'ble'), row(YESTERDAY_MIDNIGHT + 8000, 65, 'chest_strap'),
  ]
}

describe.skipIf(!canRun)('getObservedHrProfileForDay — the kept day part gives the direct query\'s answer', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let oura: typeof import('@/lib/data/postgres/slices/oura')

  async function seed(rows: Row[]) {
    await pool.query(
      `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source)
       SELECT $1, ts, bpm, src FROM unnest($2::timestamptz[], $3::int[], $4::text[]) AS t(ts, bpm, src)
       ON CONFLICT (user_id, timestamp) DO UPDATE SET bpm = excluded.bpm, source = excluded.source`,
      [USER, rows.map(r => r.at.toISOString()), rows.map(r => Math.round(r.bpm)), rows.map(r => r.source)],
    )
  }

  /** Both paths for a "now" of `to`; asserts they agree and returns the answer. */
  async function bothAgree(to: Date, from = fromFor(to)) {
    const direct = await oura.getObservedHrProfile(db, USER, from, to)
    const kept = await oura.getObservedHrProfileForDay(db, USER, from, to, TZ)
    expect(kept).toEqual(direct)
    return kept
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    db = client.getDb()
    oura = await import('@/lib/data/postgres/slices/oura')
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'hr-day-3774@example.com', 'x', $2)
       ON CONFLICT (id) DO NOTHING`, [USER, TZ])
  })

  afterAll(async () => {
    setObservedHrDayCacheEnabled(null)
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM daily_zone_minutes WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [USER])
    await seed(fixture())
    for (const m of [MIDNIGHT, YESTERDAY_MIDNIGHT]) {
      await pool.query(
        `DELETE FROM oura_heartrate WHERE user_id = $1 AND source = 'ble' AND timestamp > $2 AND timestamp < $3`,
        [USER, new Date(m - 20 * MIN), new Date(m + 6 * MIN)])
    }
    await seed(seamRows())
    setObservedHrDayCacheEnabled(true)
  })

  it('is off under test until a test turns it on', () => {
    setObservedHrDayCacheEnabled(null)
    expect(observedHrDayCacheEnabled()).toBe(false)
  })

  it('agrees through the day and across the day change', async () => {
    const nows = [
      MIDNIGHT - 26 * HOUR,          // the day before yesterday, late evening
      YESTERDAY_MIDNIGHT - 1,
      YESTERDAY_MIDNIGHT,
      YESTERDAY_MIDNIGHT + 5000,     // between the ring row and the strap row of one bucket
      YESTERDAY_MIDNIGHT + 9 * HOUR,
      MIDNIGHT - 10 * MIN,           // yesterday, before the seam
      MIDNIGHT - 3 * MIN,            // yesterday, inside the last five minutes
      MIDNIGHT - 1,
      MIDNIGHT,                      // exactly midnight
      MIDNIGHT + 1,
      MIDNIGHT + 19_000,             // before the ring row that covers the last minutes of yesterday
      MIDNIGHT + 90_000,
      MIDNIGHT + 4 * MIN,
      MIDNIGHT + 6 * HOUR,
      MIDDAY + 20 * MIN + 500,       // mid-way through the strap hour
      MIDDAY + 11 * HOUR,
      MIDNIGHT + 24 * HOUR - 1,      // the last millisecond of today
      MIDNIGHT + 24 * HOUR + 2 * MIN, // tomorrow
    ]
    const answers = []
    for (const ms of nows) answers.push(await bothAgree(new Date(ms)))
    // Guards the fixture, not the code: the answers must actually differ through the day, or the
    // cases above would agree trivially.
    expect(new Set(answers.map(a => `${a.sampleCount}/${a.max}/${a.outOfBandRejected}`)).size).toBeGreaterThanOrEqual(8)
    expect(answers.at(-1)!.isReliable).toBe(true)
    // And again in the other order, against entries that are now all filled.
    for (const ms of [...nows].reverse()) await bothAgree(new Date(ms))
  })

  it('agrees for the cardio card\'s two 30-day windows', async () => {
    const day = 86_400_000
    for (const now of [MIDNIGHT + 1, MIDDAY, MIDNIGHT + 23 * HOUR]) {
      const observedFrom = new Date(MIDNIGHT - 30 * day)
      await bothAgree(new Date(now), observedFrom)
      await bothAgree(observedFrom, new Date(observedFrom.getTime() - 30 * day))
    }
    // A window that ends inside the fixture, at a local midnight, as the prior window does.
    await bothAgree(new Date(MIDNIGHT), new Date(MIDNIGHT - 30 * day))
    await bothAgree(new Date(MIDNIGHT - day), new Date(MIDNIGHT - 31 * day))
  })

  it('runs the long query once a day, however many calls follow', async () => {
    const before = { ...observedHrQueryCounts }
    const from = fromFor(new Date(MIDDAY))
    for (const ms of [MIDNIGHT + 5 * MIN, MIDDAY, MIDDAY + 1, MIDDAY + 6 * HOUR]) {
      await oura.getObservedHrProfileForDay(db, USER, from, new Date(ms), TZ)
    }
    expect(observedHrQueryCounts.closedFill - before.closedFill).toBe(1)
    expect(observedHrQueryCounts.todayOnly - before.todayOnly).toBe(4)
    expect(observedHrQueryCounts.direct - before.direct).toBe(0)
  })

  it('shares one fill between calls that arrive together', async () => {
    const before = observedHrQueryCounts.closedFill
    const from = fromFor(new Date(MIDDAY))
    const all = await Promise.all([0, 1, 2, 3].map(i => oura.getObservedHrProfileForDay(db, USER, from, new Date(MIDDAY + i), TZ)))
    expect(observedHrQueryCounts.closedFill - before).toBe(1)
    expect(all[0]).toEqual(await oura.getObservedHrProfile(db, USER, from, new Date(MIDDAY)))
  })

  it('a late row for an earlier day is in the next answer', async () => {
    const to = new Date(MIDDAY)
    const first = await bothAgree(to)
    const fills = observedHrQueryCounts.closedFill
    // Six readings above everything else, two days ago: enough to move the k-th highest.
    await oura.upsertOuraHeartrate(db, USER, Array.from({ length: 6 }, (_, i) => ({
      timestamp: new Date(MIDDAY - 48 * HOUR + 7 * MIN + i * 20_000 + 137), bpm: 205 + i, source: 'ble',
    })))
    const second = await bothAgree(to)
    expect(second.max).not.toBe(first.max)
    expect(observedHrQueryCounts.closedFill - fills).toBe(1)
  })

  it('a late row in the last five minutes before midnight is in the next answer', async () => {
    const to = new Date(MIDDAY)
    const first = await bothAgree(to)
    const fills = observedHrQueryCounts.closedFill
    // A ring row four minutes before midnight: outside the kept part itself, but it now covers the
    // Health Connect row seven minutes before midnight, which is inside it.
    await oura.upsertOuraHeartrate(db, USER, [{ timestamp: new Date(MIDNIGHT - 4 * MIN), bpm: 60, source: 'ble' }])
    const second = await bothAgree(to)
    expect(second.sampleCount).toBe(first.sampleCount)  // one row read, one no longer read
    expect(second.highestPlausible).not.toBe(first.highestPlausible)
    expect(observedHrQueryCounts.closedFill - fills).toBe(1)
  })

  it('late Health Connect rows for an earlier day are in the next answer', async () => {
    const to = new Date(MIDDAY)
    const first = await bothAgree(to)
    await oura.upsertAggregatorHeartrate(db, USER, Array.from({ length: 6 }, (_, i) => ({
      timestamp: new Date(MIDDAY - 96 * HOUR + i * 20 * MIN + 777), bpm: 201 + i,
    })), 'health_connect', TZ)
    expect((await bothAgree(to)).max).not.toBe(first.max)
  })

  it('the ring rollup deleting an earlier day\'s rows is in the next answer', async () => {
    const { createPostgresRollupIO } = await import('@/lib/data/postgres/rollup-io')
    const io = createPostgresRollupIO({ db, userId: USER } as never)
    const to = new Date(MIDDAY)
    const first = await bothAgree(to)
    const since = new Date(MIDDAY - 30 * HOUR)
    const kept = (await pool.query<{ timestamp: Date }>(
      `SELECT timestamp FROM oura_heartrate WHERE user_id = $1 AND source = 'ble' AND timestamp >= $2 AND bpm < 150`, [USER, since],
    )).rows.map(r => r.timestamp)
    await io.deleteBleHeartrateNotIn(since, kept)
    expect((await bothAgree(to)).sampleCount).toBeLessThan(first.sampleCount)
  })

  it('today\'s rows change the answer without a second long query', async () => {
    const to = new Date(MIDDAY + 2 * HOUR)
    const first = await bothAgree(to)
    const fills = observedHrQueryCounts.closedFill
    await oura.upsertOuraHeartrate(db, USER, Array.from({ length: 6 }, (_, i) => ({
      timestamp: new Date(MIDDAY + HOUR + i * 20_000 + 137), bpm: 206 + i, source: 'ble',
    })))
    expect((await bothAgree(to)).max).not.toBe(first.max)
    expect(observedHrQueryCounts.closedFill - fills).toBe(0)
  })

  it('the retention prune cannot reach a kept window', () => {
    // `pruneHeartrate` does not drop entries, on the strength of this margin.
    expect(oura.HR_RETENTION_DAYS).toBeGreaterThan(OBSERVED_WINDOW_DAYS + 2)
  })
})

describe('the kept-day cache itself', () => {
  const split = (from: Date, to: Date) => splitObservedWindow(from, to, TZ)!
  const counts = async () => new Map([[70, 1]])
  beforeEach(() => setObservedHrDayCacheEnabled(true))
  afterAll(() => setObservedHrDayCacheEnabled(null))

  it('splits five minutes short of the local midnight of the window\'s last day', () => {
    const s = split(new Date(MIDNIGHT - 90 * 86_400_000), new Date(MIDDAY))
    expect(s.localDate).toBe(TODAY)
    expect(s.midnight.getTime()).toBe(MIDNIGHT)
    expect(s.closedEnd.getTime()).toBe(MIDNIGHT - MERGE_SEAM_MS)
    expect(MERGE_SEAM_MS).toBeGreaterThanOrEqual(AGGREGATOR_COVER_MS)
    // A window that starts inside the seam is not split.
    expect(splitObservedWindow(new Date(MIDNIGHT - 60_000), new Date(MIDDAY), TZ)).toBeNull()
  })

  it('keys by the local date, so the same instant window on another day is another entry', async () => {
    const from = new Date(MIDNIGHT - 90 * 86_400_000)
    let fills = 0
    const fill = () => { fills++; return counts() }
    await closedObservedCounts('u1', from, split(from, new Date(MIDDAY)), fill)
    await closedObservedCounts('u1', from, split(from, new Date(MIDDAY + HOUR)), fill)
    expect(fills).toBe(1)
    await closedObservedCounts('u1', from, split(from, new Date(MIDDAY + 24 * HOUR)), fill)
    await closedObservedCounts('u2', from, split(from, new Date(MIDDAY)), fill)
    expect(fills).toBe(3)
  })

  it('refills after the time limit, and never keeps a failed fill', async () => {
    const from = new Date(MIDNIGHT - 90 * 86_400_000)
    const s = split(from, new Date(MIDDAY))
    let fills = 0
    const fill = () => { fills++; return counts() }
    await closedObservedCounts('u1', from, s, fill, 1_000)
    await closedObservedCounts('u1', from, s, fill, 1_000 + MAX_AGE_MS)
    expect(fills).toBe(1)
    await closedObservedCounts('u1', from, s, fill, 1_001 + MAX_AGE_MS)
    expect(fills).toBe(2)

    setObservedHrDayCacheEnabled(true)
    await expect(closedObservedCounts('u1', from, s, async () => { throw new Error('db down') })).rejects.toThrow('db down')
    await Promise.resolve()
    expect(observedHrDayCacheSize()).toBe(0)
  })

  it('holds a bounded number of entries', async () => {
    const from = new Date(MIDNIGHT - 90 * 86_400_000)
    const s = split(from, new Date(MIDDAY))
    for (let i = 0; i < MAX_ENTRIES + 25; i++) await closedObservedCounts(`u${i}`, from, s, counts)
    expect(observedHrDayCacheSize()).toBe(MAX_ENTRIES)
  })

  it('drops only the entries a change can touch', async () => {
    const from = new Date(MIDNIGHT - 90 * 86_400_000)
    const s = split(from, new Date(MIDDAY))
    const refill = async (user: string) => { let n = 0; await closedObservedCounts(user, from, s, () => { n++; return counts() }); return n }
    await refill('u1'); await refill('u2')

    dropObservedHrDay('u1', { earliestMs: MIDNIGHT, latestMs: MIDDAY })                       // today only
    dropObservedHrDay('u1', { earliestMs: from.getTime() - HOUR, latestMs: from.getTime() - 1 }) // before the window
    expect(await refill('u1')).toBe(0)
    dropObservedHrDay('u1', { earliestMs: MIDNIGHT - 1, latestMs: MIDDAY })                    // the seam
    expect(await refill('u1')).toBe(1)
    expect(await refill('u2')).toBe(0)
    dropObservedHrDay('u2')
    expect(await refill('u2')).toBe(1)
  })
})
