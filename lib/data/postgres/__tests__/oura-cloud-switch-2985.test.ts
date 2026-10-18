// #2985: after the user's switch to the Oura API, an `oura_cloud` value beats a leftover `oura_ble`
// partial per field, and a later ring write cannot take the field back; before the switch day the
// ladder is untouched. The switch day is the day the ring stopped sending over Bluetooth, read from
// the raw archive while an Oura connection exists, so a reconnect does not move it. Also: a day with
// no heart rate is missing from the zone-minutes read, never a day of zeros.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000002985'
// 01:10 on 18 Oct in Brisbane: the switch day is the 18th.
const CONNECTED_AT = '2026-10-17T15:10:50Z'

describe.skipIf(!canRun)('Oura per-day switch rule (#2985)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const clear = async () => {
    // Only this fixture user's rows, in the local test database.
    for (const t of ['body_metrics', 'oura_daily', 'oura_tokens', 'oura_heartrate', 'daily_zone_minutes', 'oura_raw_samples']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
  }
  const connect = (createdAt = CONNECTED_AT, pat: string | null = null) => pool.query(
    `INSERT INTO oura_tokens (user_id, access_token, refresh_token, personal_access_token, created_at)
     VALUES ($1, 'enc', 'enc', $2, $3)`, [USER, pat, createdAt])
  const disconnect = () => pool.query(`DELETE FROM oura_tokens WHERE user_id = $1`, [USER])
  // One raw Bluetooth frame, received by the server at `recordedAt`.
  const bleFrame = (ds: number, recordedAt: string) => pool.query(
    `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, recorded_at)
     VALUES ($1, $2, 80, 'activity_information', '0014', $3)`, [USER, ds, recordedAt])
  const body = async (date: string) => (await pool.query(
    `SELECT steps, hrv_ms, source_map FROM body_metrics WHERE user_id = $1 AND date = $2`, [USER, date])).rows[0]
  const daily = async (date: string) => (await pool.query(
    `SELECT non_wear_time_sec, source_map FROM oura_daily WHERE user_id = $1 AND date = $2`, [USER, date])).rows[0]

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, `switch-${USER}@example.com`])
  })
  afterAll(async () => {
    if (!canRun) return
    await clear()
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })
  beforeEach(clear)

  it('reads the switch day from the stored connection, in the user\'s timezone', async () => {
    expect(await repo.getOuraCloudSwitchDay(USER)).toBeNull()
    await connect()
    expect(await repo.getOuraCloudSwitchDay(USER)).toBe('2026-10-18')
  })

  it('with Bluetooth history, it is the day the ring last sent, not the day of the connection', async () => {
    // The ring's last frames reach the server at 00:14 on 18 Oct, Brisbane; an older frame, by ring
    // time, arrives later in a re-drain and does not count as newer.
    await bleFrame(1_000_000, '2026-10-16T09:00:00Z')
    await bleFrame(1_200_000, '2026-10-17T14:14:00Z')
    await bleFrame(900_000, '2026-10-17T14:15:00Z')
    expect(await repo.getOuraCloudSwitchDay(USER)).toBeNull()
    await connect('2026-10-19T03:00:00Z')
    expect(await repo.getOuraCloudSwitchDay(USER)).toBe('2026-10-18')
  })

  it('a disconnect and a reconnect a day later leave the switch day where it was', async () => {
    await bleFrame(1_200_000, '2026-10-17T14:14:00Z')
    await connect()
    expect(await repo.getOuraCloudSwitchDay(USER)).toBe('2026-10-18')
    await disconnect()
    expect(await repo.getOuraCloudSwitchDay(USER)).toBeNull()
    await connect('2026-10-19T00:30:00Z') // 10:30 on the 19th, Brisbane
    expect(await repo.getOuraCloudSwitchDay(USER)).toBe('2026-10-18')
  })

  it('a user with no Bluetooth history uses the day of the connection', async () => {
    await connect('2026-10-19T00:30:00Z')
    expect(await repo.getOuraCloudSwitchDay(USER)).toBe('2026-10-19')
  })

  it('if the ring goes back on Bluetooth, the switch day moves forward with it', async () => {
    await bleFrame(1_200_000, '2026-10-17T14:14:00Z')
    await connect()
    await bleFrame(1_300_000, '2026-10-21T02:00:00Z')
    expect(await repo.getOuraCloudSwitchDay(USER)).toBe('2026-10-21')
  })

  it('a row still holding a personal access token predates the connector, so it is no switch', async () => {
    await connect('2026-01-01T00:00:00Z', 'legacy-pat')
    expect(await repo.getOuraCloudSwitchDay(USER)).toBeNull()
  })

  it('after the switch Oura beats a partial ring value; before it the ring still wins', async () => {
    await connect()
    await repo.upsertBodyMetrics(USER, [{ date: '2026-10-17', steps: 8000 }, { date: '2026-10-18', steps: 300 }], 'oura_ble')
    await repo.upsertBodyMetrics(USER, [{ date: '2026-10-17', steps: 7000 }, { date: '2026-10-18', steps: 9000 }], 'oura_cloud')
    expect(await body('2026-10-17')).toMatchObject({ steps: 8000, source_map: { steps: 'oura_ble' } })
    expect(await body('2026-10-18')).toMatchObject({ steps: 9000, source_map: { steps: 'oura_cloud' } })
  })

  it('a ring write after the switch cannot take a field back from Oura, but can fill an empty one', async () => {
    await connect()
    await repo.upsertBodyMetrics(USER, [{ date: '2026-10-18', steps: 9000 }], 'oura_cloud')
    await repo.upsertBodyMetrics(USER, [{ date: '2026-10-18', steps: 300, hrvMs: 50 }], 'oura_ble')
    expect(await body('2026-10-18')).toMatchObject({ steps: 9000, hrv_ms: 50, source_map: { steps: 'oura_cloud', hrv_ms: 'oura_ble' } })
  })

  it('a manual value still beats Oura on a switch day', async () => {
    await connect()
    await repo.upsertBodyMetrics(USER, [{ date: '2026-10-18', steps: 5000 }], 'manual')
    await repo.upsertBodyMetrics(USER, [{ date: '2026-10-18', steps: 9000 }], 'oura_cloud')
    expect(await body('2026-10-18')).toMatchObject({ steps: 5000, source_map: { steps: 'manual' } })
  })

  it('without a connection the ladder is unchanged: the ring keeps its field', async () => {
    await repo.upsertBodyMetrics(USER, [{ date: '2026-10-18', steps: 300 }], 'oura_ble')
    await repo.upsertBodyMetrics(USER, [{ date: '2026-10-18', steps: 9000 }], 'oura_cloud')
    expect(await body('2026-10-18')).toMatchObject({ steps: 300, source_map: { steps: 'oura_ble' } })
  })

  it('applies to oura_daily too: Oura\'s non-wear replaces the ring\'s partial on the switch day (a re-import rewrites it)', async () => {
    await connect()
    await repo.upsertOuraDaily(USER, [{ date: '2026-10-17', nonWearTimeSec: 600 }, { date: '2026-10-18', nonWearTimeSec: 85_000 }], 'oura_ble')
    await repo.upsertOuraDaily(USER, [{ date: '2026-10-17', nonWearTimeSec: 900 }, { date: '2026-10-18', nonWearTimeSec: 1_200 }], 'oura_cloud')
    expect((await daily('2026-10-17')).non_wear_time_sec).toBe(600)
    expect((await daily('2026-10-18')).non_wear_time_sec).toBe(1_200)
    // The same documents read again (the connect backfill or the backfill job) leave the same row.
    await repo.upsertOuraDaily(USER, [{ date: '2026-10-18', nonWearTimeSec: 1_200 }], 'oura_cloud')
    expect((await daily('2026-10-18')).non_wear_time_sec).toBe(1_200)
  })

  it('zone minutes: a day with no heart rate is left out, never a day of zeros', async () => {
    const profile = { maxHr: 180, restingHr: 55 }
    // An all-zero row cached for the 15th before this rule; the 16th has heart rate.
    await pool.query(
      `INSERT INTO daily_zone_minutes (user_id, day, zone1_sec, zone2_sec, zone3_sec, zone4_sec, zone5_sec, max_hr, resting_hr)
       VALUES ($1, '2026-10-15', 0, 0, 0, 0, 0, 180, 55)`, [USER])
    const noon = Date.parse('2026-10-16T02:00:00Z')
    await repo.upsertOuraHeartrate(USER, Array.from({ length: 60 }, (_, i) => ({ timestamp: new Date(noon + i * 60_000), bpm: 140, source: 'oura_ble' })))
    const days = await repo.getZoneMinutesRange(USER, '2026-10-14', '2026-10-16', 'Australia/Brisbane', profile)
    expect(days.map(d => d.day)).toEqual(['2026-10-16'])
    expect(days[0].seconds.some(v => v > 0)).toBe(true)
    // Nothing cached for a day without heart rate, so heart rate that lands later is read.
    const cached = await pool.query(`SELECT day FROM daily_zone_minutes WHERE user_id = $1 AND day = '2026-10-14'`, [USER])
    expect(cached.rowCount).toBe(0)
  })
})
