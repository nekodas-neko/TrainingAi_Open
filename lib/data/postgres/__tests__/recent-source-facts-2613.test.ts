import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

/**
 * Issue 2613 — the facts behind `connectedSources`, against a real Postgres. Pins what each flag
 * means: strap is a recent `chest_strap` heart-rate row, Health Connect is a recent `health_connect`
 * heart-rate row or movement interval, ring-sourced rows count as neither, old rows age out of the
 * window, and another user's rows never leak in. Skips cleanly without DATABASE_URL.
 */
const canRun = !!process.env.DATABASE_URL
const USER_A = '00000000-0000-4000-8000-000000261301'
const USER_B = '00000000-0000-4000-8000-000000261302'
const DAY = 86_400_000

describe.skipIf(!canRun)('getRecentSourceFacts (issue 2613)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const since = new Date(Date.now() - 30 * DAY)
  const recent = new Date(Date.now() - 2 * DAY)
  const old = new Date(Date.now() - 60 * DAY)
  const at = (d: Date, ms: number) => new Date(d.getTime() + ms)

  const clean = async () => {
    for (const t of ['oura_heartrate', 'health_connect_intervals', 'oura_raw_samples']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = ANY($1::uuid[])`, [[USER_A, USER_B]])
    }
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const id of [USER_A, USER_B]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
        [id, `src2613-${id}@example.com`],
      )
    }
  })
  beforeEach(clean)
  afterAll(clean)

  const none = { strapHeartRate: false, healthConnectHeartRate: false, healthConnectIntervals: false }
  const interval = (id: string) => ({ kind: 'steps' as const, recordId: id, startAt: recent, endAt: at(recent, 60_000), value: 50, dataOrigin: null, deviceType: null })

  it('is all false for a user with no data', async () => {
    expect(await repo.getRecentSourceFacts(USER_A, since)).toEqual(none)
    expect(await repo.hasOuraBleSamples(USER_A)).toBe(false)
  })

  it('ring-only: ring heart rate is neither strap nor Health Connect; the ring fact is raw samples', async () => {
    await repo.upsertOuraHeartrate(USER_A, [{ timestamp: recent, bpm: 60, source: 'ble' }])
    await repo.insertOuraRawSamples(USER_A, [{ ringTimestampDs: 1000, tag: 1, eventName: 'x', bodyHex: '00', decoded: null }])
    expect(await repo.getRecentSourceFacts(USER_A, since)).toEqual(none)
    expect(await repo.hasOuraBleSamples(USER_A)).toBe(true)
  })

  it('strap-only: a chest_strap row inside the window', async () => {
    await repo.upsertOuraHeartrate(USER_A, [{ timestamp: recent, bpm: 120, source: 'chest_strap' }])
    expect(await repo.getRecentSourceFacts(USER_A, since)).toEqual({ ...none, strapHeartRate: true })
  })

  it('Health Connect-only: via heart rate, and separately via a movement interval', async () => {
    await repo.upsertOuraHeartrate(USER_A, [{ timestamp: recent, bpm: 70, source: 'health_connect' }])
    expect(await repo.getRecentSourceFacts(USER_A, since)).toEqual({ ...none, healthConnectHeartRate: true })
    await clean()
    await repo.upsertHealthConnectIntervals(USER_A, [interval('r1')])
    expect(await repo.getRecentSourceFacts(USER_A, since)).toEqual({ ...none, healthConnectIntervals: true })
  })

  it('rows older than the window do not count', async () => {
    await repo.upsertOuraHeartrate(USER_A, [
      { timestamp: old, bpm: 120, source: 'chest_strap' },
      { timestamp: at(old, 1000), bpm: 70, source: 'health_connect' },
    ])
    expect(await repo.getRecentSourceFacts(USER_A, since)).toEqual(none)
  })

  it("is scoped to the user: another user's rows never appear", async () => {
    await repo.upsertOuraHeartrate(USER_B, [
      { timestamp: recent, bpm: 120, source: 'chest_strap' },
      { timestamp: at(recent, 1000), bpm: 70, source: 'health_connect' },
    ])
    await repo.upsertHealthConnectIntervals(USER_B, [interval('r2')])
    expect(await repo.getRecentSourceFacts(USER_A, since)).toEqual(none)
    expect(await repo.getRecentSourceFacts(USER_B, since)).toEqual({ strapHeartRate: true, healthConnectHeartRate: true, healthConnectIntervals: true })
  })
})
