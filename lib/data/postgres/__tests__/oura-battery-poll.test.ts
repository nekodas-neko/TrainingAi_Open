// Live battery-poll persistence (migration 133). Proves the real Drizzle insert/read round-trip
// against Postgres (the route test mocks the repo, so this covers the DB layer).
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000ba770'

describe.skipIf(!canRun)('oura battery-poll persistence', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `battery-${TEST_USER_ID}@example.com`],
    )
    await pool.query(`DELETE FROM oura_ble_battery_poll WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_ble_battery_poll WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('persists polls and reads them back in time order within the window', async () => {
    await repo.insertOuraBatteryPoll(TEST_USER_ID, 82, false)
    await repo.insertOuraBatteryPoll(TEST_USER_ID, 100, true)
    await repo.insertOuraBatteryPoll(TEST_USER_ID, 55, null)

    // Window carries ±1h margin: measured_at is stamped by the DB clock (now()), which can run
    // slightly ahead of this runner's clock, so a just-inserted row's measured_at may exceed a
    // JS-captured `new Date()` upper bound and be wrongly excluded (a clock-skew flake in CI).
    const from = new Date(Date.now() - 3_600_000)
    const to = new Date(Date.now() + 3_600_000)
    const polls = await repo.getOuraBatteryPolls(TEST_USER_ID, from, to)

    expect(polls.length).toBe(3)
    expect(polls.map(p => p.percent).sort((a, b) => a - b)).toEqual([55, 82, 100])
    const charged = polls.find(p => p.percent === 100)
    expect(charged?.charging).toBe(true)
    expect(polls.find(p => p.percent === 55)?.charging).toBeNull()
    expect(polls.every(p => p.tsMs >= from.getTime() && p.tsMs <= to.getTime())).toBe(true)
  })

  it('excludes polls outside the requested window', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000)
    const farFuture = new Date(Date.now() + 4 * 86_400_000)
    const polls = await repo.getOuraBatteryPolls(TEST_USER_ID, future, farFuture)
    expect(polls.length).toBe(0)
  })

  // #3069: Oura Cloud readings share the table, labelled by source.
  it('stores Oura Cloud readings once, keeps them out of the Bluetooth read, and reads both together', async () => {
    const t0 = new Date('2026-09-01T01:00:00Z')
    const reading = (min: number, percent: number, charging: boolean | null) => ({ measuredAt: new Date(t0.getTime() + min * 60_000), percent, charging })
    expect(await repo.insertOuraCloudBatteryReadings(TEST_USER_ID, [reading(0, 80, false), reading(15, 79, null), reading(15, 79, null)])).toBe(2)
    // A re-read overlapping the stored span adds only what is new.
    expect(await repo.insertOuraCloudBatteryReadings(TEST_USER_ID, [reading(15, 79, null), reading(30, 100, true)])).toBe(1)

    const from = new Date('2026-08-31T00:00:00Z'), to = new Date('2026-09-02T00:00:00Z')
    expect(await repo.getOuraBatteryPolls(TEST_USER_ID, from, to)).toEqual([])
    const all = await repo.getRingBatteryReadings(TEST_USER_ID, from, to)
    expect(all.map(r => [r.percent, r.charging])).toEqual([[80, false], [79, null], [100, true]])
    expect((await repo.getLatestOuraCloudBatteryAt(TEST_USER_ID, from))?.getTime()).toBe(t0.getTime() + 30 * 60_000)
    expect(await repo.getLatestOuraCloudBatteryAt(TEST_USER_ID, to)).toBeNull()

    const { rows } = await pool.query(`SELECT DISTINCT source FROM oura_ble_battery_poll WHERE user_id = $1 AND measured_at < $2`, [TEST_USER_ID, to])
    expect(rows).toEqual([{ source: 'oura_cloud' }])
  })

  it('leaves Bluetooth polls with no source', async () => {
    const { rows } = await pool.query(`SELECT DISTINCT source FROM oura_ble_battery_poll WHERE user_id = $1 AND measured_at > now() - interval '1 day'`, [TEST_USER_ID])
    expect(rows).toEqual([{ source: null }])
  })

  // #3069 review: the read is bounded, the table is not pruned, and concurrent catch-ups do not
  // store an instant twice.
  describe('bounded read, no prune, no duplicate instants', () => {
    const USER = '00000000-0000-4000-8000-31b12c3f966b'
    const at = (iso: string, percent: number, charging: boolean | null, source: string | null = null) =>
      pool.query(`INSERT INTO oura_ble_battery_poll (user_id, measured_at, percent, charging, source) VALUES ($1, $2, $3, $4, $5)`, [USER, iso, percent, charging, source])

    beforeAll(async () => {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
        [USER, `battery-${USER}@example.com`],
      )
    })
    beforeEach(() => pool.query(`DELETE FROM oura_ble_battery_poll WHERE user_id = $1`, [USER]))
    afterAll(async () => {
      await pool.query(`DELETE FROM oura_ble_battery_poll WHERE user_id = $1`, [USER])
      await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    })

    const to = new Date('2026-10-20T12:00:00Z')

    it('returns every reading in the last two days, and before that one per hour plus the rows that mark a charge', async () => {
      // Five days back: four readings in one hour (a charge: 70 reported charging, 75 a rise) and one the next hour.
      await at('2026-10-15T03:00:00Z', 80, false)
      await at('2026-10-15T03:15:00Z', 70, true, 'oura_cloud')
      await at('2026-10-15T03:30:00Z', 75, null)
      await at('2026-10-15T03:45:00Z', 74, false)
      await at('2026-10-15T04:05:00Z', 72, false)
      // Inside the two-day detail window: all kept, even in one hour.
      await at('2026-10-19T08:00:00Z', 60, false)
      await at('2026-10-19T08:05:00Z', 59, false)
      await at('2026-10-19T08:10:00Z', 58, false)

      const got = await repo.getRingBatteryReadings(USER, new Date('2026-06-01T00:00:00Z'), to)
      expect(got.map(r => [new Date(r.tsMs).toISOString(), r.percent, r.charging])).toEqual([
        ['2026-10-15T03:15:00.000Z', 70, true],   // kept: reported as charging, and the row before the rise
        ['2026-10-15T03:30:00.000Z', 75, null],   // kept: a rise
        ['2026-10-15T03:45:00.000Z', 74, true],   // last of the hour; charging because one reading was
        ['2026-10-15T04:05:00.000Z', 72, false],
        ['2026-10-19T08:00:00.000Z', 60, false],
        ['2026-10-19T08:05:00.000Z', 59, false],
        ['2026-10-19T08:10:00.000Z', 58, false],
      ])
    })

    it('leaves a reading with no charging report as null, and honours the window', async () => {
      await at('2026-10-01T03:00:00Z', 50, null)
      await at('2026-08-01T03:00:00Z', 90, null)
      const got = await repo.getRingBatteryReadings(USER, new Date('2026-09-01T00:00:00Z'), to)
      expect(got.map(r => [r.percent, r.charging])).toEqual([[50, null]])
    })

    it('does not prune old readings when a Bluetooth poll is stored', async () => {
      await at('2026-03-01T00:00:00Z', 90, false)
      // A prune was throttled to once a day per process, and the tests above already store polls, so
      // it would never fire here. A fresh module has an untouched throttle: a prune would run now.
      vi.resetModules()
      const { getRepository } = await import('@/lib/data')
      const { getPool } = await import('@/lib/data/postgres/client')
      const fresh = await getRepository()
      try {
        await fresh.insertOuraBatteryPoll(USER, 55, false)
        await new Promise(resolve => setTimeout(resolve, 500)) // a prune is fire-and-forget
        const { rows } = await pool.query(`SELECT count(*)::int AS n FROM oura_ble_battery_poll WHERE user_id = $1 AND measured_at < '2026-04-01'`, [USER])
        expect(rows[0].n).toBe(1)
      } finally {
        await getPool().end()
      }
    })

    it('stores each instant once when catch-ups run together', async () => {
      // A cold pool opens its connections one at a time and so serialises the transactions; with the
      // pool warm every call gets its own connection and the lock is what keeps the instants single.
      await Promise.all(Array.from({ length: 8 }, () => pool.query('SELECT pg_sleep(0.05)')))
      const t0 = new Date('2026-10-10T00:00:00Z')
      const batch = Array.from({ length: 200 }, (_, i) => ({ measuredAt: new Date(t0.getTime() + i * 900_000), percent: 90 - (i % 50), charging: null }))
      const inserted = await Promise.all([
        repo.insertOuraCloudBatteryReadings(USER, batch),
        repo.insertOuraCloudBatteryReadings(USER, batch),
        repo.insertOuraCloudBatteryReadings(USER, batch),
        repo.insertOuraCloudBatteryReadings(USER, batch.slice(5)),
        repo.insertOuraCloudBatteryReadings(USER, batch.slice(50)),
      ])
      expect(inserted.reduce((a, b) => a + b, 0)).toBe(200)
      const { rows } = await pool.query(`SELECT count(*)::int AS n, count(DISTINCT measured_at)::int AS d FROM oura_ble_battery_poll WHERE user_id = $1`, [USER])
      expect(rows[0]).toEqual({ n: 200, d: 200 })
    })

    it('keeps the rows around a charge, so the summary reads its length back from the hourly part', async () => {
      // Ten days back (all hourly): a reading every 5 min, falling 1 point per 30 min, with a charge of
      // exactly 45 min (last level before the rise at 04:00, last rise at 04:45), held full to 05:30.
      const day = Date.parse('2026-10-10T00:00:00Z')
      const rows: [number, number, boolean][] = []
      for (let m = 0; m <= 12 * 60; m += 5) {
        let percent: number, charging = false
        if (m < 240) percent = 90 - Math.floor(m / 30)
        else if (m <= 285) { percent = Math.min(100, 82 + (m - 240) / 5 * 2); charging = m > 240 }
        else if (m <= 330) { percent = 100; charging = true }
        else percent = 100 - Math.floor((m - 330) / 30)
        rows.push([day + m * 60_000, percent, charging])
      }
      for (const [t, percent, charging] of rows) await at(new Date(t).toISOString(), percent, charging)

      const got = await repo.getRingBatteryReadings(USER, new Date('2026-06-01T00:00:00Z'), to)
      expect(got.length).toBeLessThan(rows.length) // still bounded: the plateaus fall to one an hour
      const { summariseRingBattery } = await import('@trainingai/shared/health/ring-battery-health')
      const health = summariseRingBattery(got, 'Australia/Brisbane', to.getTime())
      expect(Math.abs(health.avgChargeSec! - 45 * 60)).toBeLessThanOrEqual(5 * 60)
    })

    it('buckets the hour in UTC whatever the session timezone', async () => {
      // 03:15 and 03:45 UTC share a UTC hour; in a +05:30 session they would fall in different ones.
      await at('2026-10-01T03:15:00Z', 80, false)
      await at('2026-10-01T03:45:00Z', 79, false)
      const { Pool } = await import('pg')
      const { drizzle } = await import('drizzle-orm/node-postgres')
      const { getRingBatteryReadings } = await import('@/lib/data/postgres/slices/oura')
      const own = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, options: '-c timezone=Asia/Kolkata' })
      try {
        const got = await getRingBatteryReadings(drizzle(own) as never, USER, new Date('2026-09-01T00:00:00Z'), to)
        expect(got.map(r => r.percent)).toEqual([79])
      } finally {
        await own.end()
      }
    })
  })
})
