// #2859 — Oura Cloud documents land in Postgres as `oura_cloud`, one field at a time, idempotently, and
// never over a better source.
//
// Runs against a real Postgres (DATABASE_URL) and skips without one. Oura is mocked at `fetch` from
// spec-shaped documents (`lib/oura/cloud/__tests__/fixtures.ts`); nothing reaches Oura.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { OURA_API_BASE, type OuraOAuthConfig } from '@/lib/oura/cloud/config'
import { encryptOuraToken } from '@/lib/oura/cloud/token-cipher'
import { DAY, FIXTURES, heartRateRows, jsonResponse, OURA_USER, sleepPeriod } from '@/lib/oura/cloud/__tests__/fixtures'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000002859'
const CONFIG: OuraOAuthConfig = { clientId: 'cid', clientSecret: 'csecret', redirectUri: 'http://localhost:3000/api/oura/callback' }
const DOC = `${OURA_API_BASE}/v2/usercollection/`

/** Oura, answering one document by id, a date range of a type, and the heart-rate series. */
function fakeOura(): typeof fetch {
  const byPath: Record<string, unknown> = {
    daily_readiness: FIXTURES.daily_readiness, daily_sleep: FIXTURES.daily_sleep, daily_activity: FIXTURES.daily_activity,
    daily_spo2: FIXTURES.daily_spo2, daily_stress: FIXTURES.daily_stress, daily_resilience: FIXTURES.daily_resilience,
    daily_cardiovascular_age: FIXTURES.daily_cardiovascular_age, vO2_max: FIXTURES.vo2_max, sleep: FIXTURES.sleep, workout: FIXTURES.workout,
  }
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (!url.href.startsWith(DOC)) return new Response('', { status: 500 })
    const [path, id] = url.pathname.replace('/v2/usercollection/', '').split('/')
    if (path === 'heartrate') return jsonResponse({ data: heartRateRows, next_token: null })
    const doc = byPath[path]
    if (!doc) return new Response('', { status: 404 })
    if (id) return (doc as { id: string }).id === decodeURIComponent(id) ? jsonResponse(doc) : new Response('', { status: 404 })
    return jsonResponse({ data: [doc], next_token: null })
  }) as typeof fetch
}

describe.skipIf(!canRun)('Oura Cloud ingest into Postgres (#2859)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const savedKey = process.env.OURA_TOKEN_KEY

  beforeAll(async () => {
    process.env.OURA_TOKEN_KEY = 'k'.repeat(48)
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, 'issue-2859@example.com'])
  })

  afterAll(async () => {
    process.env.OURA_TOKEN_KEY = savedKey
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) // cascades every table below
  })

  beforeEach(async () => {
    for (const t of ['oura_daily', 'body_metrics', 'sleep_sessions', 'oura_workouts', 'oura_heartrate', 'oura_tokens']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
    await repo.saveOuraCloudTokens(USER, {
      accessToken: encryptOuraToken('acc', USER, 'access_token'),
      refreshToken: encryptOuraToken('ref', USER, 'refresh_token'),
      expiresAt: new Date(Date.now() + 86_400_000), scope: 'daily', ouraUserId: OURA_USER,
    })
    vi.stubGlobal('fetch', fakeOura())
  })
  afterEach(() => vi.unstubAllGlobals())

  const one = async (sql: string) => (await pool.query(sql, [USER])).rows[0]
  const rawArchiveCount = async () =>
    Number((await pool.query(`SELECT (SELECT count(*) FROM oura_raw_samples WHERE user_id = $1) + (SELECT count(*) FROM oura_raw_packed WHERE user_id = $1) AS n`, [USER])).rows[0].n)

  /** Every fixture as a webhook event. Returns who a heart-rate catch-up was started for; the
   *  catch-up itself is not started, so no background write races these tests' counts. */
  async function webhookAll(): Promise<string[]> {
    const { handleOuraWebhookEvent } = await import('@/lib/oura/cloud/webhook')
    const heartRateFor: string[] = []
    for (const [type, doc] of Object.entries(FIXTURES)) {
      const out = await handleOuraWebhookEvent({ repo, config: CONFIG, heartRate: u => heartRateFor.push(u) }, { event_type: 'update', data_type: type, object_id: doc.id, user_id: OURA_USER })
      expect(out.result, type).toBe('written')
    }
    return heartRateFor
  }

  it('routes the event to the user and lands every field with oura_cloud provenance', async () => {
    const before = await rawArchiveCount()
    await webhookAll()

    const daily = await one(`SELECT * FROM oura_daily WHERE user_id = $1`)
    const dailyCols = [
      'readiness_score', 'temperature_deviation', 'temperature_trend_deviation',
      'sleep_score', 'activity_score', 'active_calories', 'total_calories', 'equivalent_walking_distance',
      'high_activity_time_sec', 'medium_activity_time_sec', 'low_activity_time_sec', 'sedentary_time_sec', 'non_wear_time_sec',
      'resting_time_sec', 'avg_met_minutes', 'high_activity_met_minutes', 'medium_activity_met_minutes',
      'low_activity_met_minutes', 'stress_high', 'recovery_high', 'vo2_max', 'vascular_age', 'pulse_wave_velocity',
      'resilience_level', 'resilience_contributors', 'breathing_disturbance_index',
    ]
    for (const c of dailyCols) {
      expect(daily[c], c).not.toBeNull()
      expect(daily.source_map[c], c).toBe('oura_cloud')
    }
    // Held back until #2860 (#2895 review): these would replace our own on the Sleep and Activity screens.
    for (const c of ['readiness_contributors', 'sleep_contributors', 'activity_contributors', 'day_summary']) {
      expect(daily[c], c).toBeNull()
    }
    expect(daily.date.toISOString?.() ?? daily.date).toContain('2026-10-')
    expect(daily.stress_high).toBe(5400)

    const body = await one(`SELECT steps, active_calories, spo2_pct, hrv_ms, resting_heart_rate, source_map FROM body_metrics WHERE user_id = $1`)
    expect(body).toMatchObject({ steps: 9123, active_calories: 512, spo2_pct: 96.4, hrv_ms: 62, resting_heart_rate: 47 })
    for (const c of ['steps', 'active_calories', 'spo2_pct', 'hrv_ms', 'resting_heart_rate']) expect(body.source_map[c], c).toBe('oura_cloud')

    const sleep = await one(`SELECT * FROM sleep_sessions WHERE user_id = $1`)
    for (const c of ['duration_hours', 'deep_sleep_hours', 'rem_sleep_hours', 'light_sleep_hours', 'awake_hours', 'efficiency',
      'onset_latency_sec', 'average_hrv_ms', 'avg_heart_rate', 'lowest_heart_rate', 'restless_periods', 'respiratory_rate',
      'sleep_phase_5_min', 'time_in_bed_hours']) {
      expect(sleep[c], c).not.toBeNull()
      expect(sleep.source_map[c], c).toBe('oura_cloud')
    }
    expect(sleep.oura_id).toBe('sl-1')
    expect(sleep.deleted_at).toBeNull()

    const workout = await one(`SELECT * FROM oura_workouts WHERE user_id = $1`)
    expect(workout).toMatchObject({ id: 'wo-1', activity: 'running', calories: 420.5, distance_m: 6012.3, intensity: 'moderate', source: 'autodetected', reviewed: false })

    expect(await rawArchiveCount()).toBe(before)
  })

  it('is idempotent: the same events twice leave the same rows', async () => {
    await webhookAll()
    const snap = async () => ({
      daily: (await pool.query(`SELECT * FROM oura_daily WHERE user_id = $1`, [USER])).rows.map(r => ({ ...r, synced_at: null })),
      body: (await pool.query(`SELECT * FROM body_metrics WHERE user_id = $1`, [USER])).rows.map(r => ({ ...r, updated_at: null })),
      sleep: (await pool.query(`SELECT * FROM sleep_sessions WHERE user_id = $1`, [USER])).rows.map(r => ({ ...r, updated_at: null })),
      workouts: (await pool.query(`SELECT * FROM oura_workouts WHERE user_id = $1`, [USER])).rows,
    })
    const first = await snap()
    await webhookAll()
    expect(await snap()).toEqual(first)
  })

  it('never overwrites the ring\'s BLE values or a manual entry; fills only what is empty', async () => {
    await repo.upsertOuraDaily(USER, [{ date: DAY, nonWearTimeSec: 600 }], 'oura_ble')
    await repo.upsertBodyMetrics(USER, [{ date: DAY, hrvMs: 70, restingHeartRate: 50 }], 'oura_ble')
    await repo.upsertBodyMetrics(USER, [{ date: DAY, steps: 12000 }], 'manual')
    await webhookAll()
    const daily = await one(`SELECT non_wear_time_sec, readiness_score, source_map FROM oura_daily WHERE user_id = $1`)
    expect(daily.non_wear_time_sec).toBe(600)
    expect(daily.source_map.non_wear_time_sec).toBe('oura_ble')
    expect(daily.readiness_score).toBe(82)
    const body = await one(`SELECT hrv_ms, resting_heart_rate, steps, spo2_pct, source_map FROM body_metrics WHERE user_id = $1`)
    expect(body).toMatchObject({ hrv_ms: 70, resting_heart_rate: 50, steps: 12000, spo2_pct: 96.4 })
    expect(body.source_map).toMatchObject({ hrv_ms: 'oura_ble', steps: 'manual', spo2_pct: 'oura_cloud' })
  })

  it('does not duplicate a night another source already holds', async () => {
    // The ring's rollup recorded the same night, starting four minutes later.
    await repo.upsertOuraSleep(USER, [{
      ouraId: 'ble:1', date: DAY, sleepStart: new Date('2026-10-09T12:34:00Z'), sleepEnd: new Date('2026-10-09T20:28:00Z'), durationHours: 7.1,
    }], 'oura_ble')
    const out = await repo.upsertOuraCloudSleep(USER, (await import('@/lib/oura/cloud/documents')).mapOuraDocuments(
      [{ type: 'sleep', doc: (await import('@/lib/oura/cloud/documents')).SleepDoc.parse(sleepPeriod) }]).sleep)
    expect(out).toEqual({ written: 0, skippedOverlap: 1 })
    const rows = (await pool.query(`SELECT oura_id, duration_hours FROM sleep_sessions WHERE user_id = $1 AND deleted_at IS NULL`, [USER])).rows
    expect(rows).toEqual([{ oura_id: 'ble:1', duration_hours: 7.1 }])
  })

  it('follows a period Oura moved to a new start, and tombstones one Oura deleted', async () => {
    const { mapOuraDocuments, SleepDoc } = await import('@/lib/oura/cloud/documents')
    const write = (doc: unknown) => repo.upsertOuraCloudSleep(USER, mapOuraDocuments([{ type: 'sleep', doc: SleepDoc.parse(doc) }]).sleep)
    await write(sleepPeriod)
    const [{ id }] = (await pool.query(`SELECT id FROM sleep_sessions WHERE user_id = $1`, [USER])).rows
    // Oura re-analyses the night: a later start, a later end, and (past midnight) the next day.
    await write({ ...sleepPeriod, day: '2026-10-11', bedtime_start: '2026-10-09T22:40:00+10:00', bedtime_end: '2026-10-10T07:15:00+10:00', total_sleep_duration: 25500 })
    const moved = (await pool.query(`SELECT id, date::text AS date, sleep_start, sleep_end, duration_hours FROM sleep_sessions WHERE user_id = $1`, [USER])).rows
    expect(moved).toHaveLength(1)
    expect(moved[0].id).toBe(id)
    expect(moved[0].sleep_start.toISOString()).toBe('2026-10-09T12:40:00.000Z')
    expect(moved[0].sleep_end.toISOString()).toBe('2026-10-09T21:15:00.000Z')
    expect(moved[0].date).toBe('2026-10-11')
    expect(moved[0].duration_hours).toBeCloseTo(25500 / 3600, 5)

    // Re-sent with only its end moved (same start): the end and day still follow.
    await write({ ...sleepPeriod, day: '2026-10-10', bedtime_start: '2026-10-09T22:40:00+10:00', bedtime_end: '2026-10-10T06:50:00+10:00' })
    const same = await one(`SELECT id, date::text AS date, sleep_end FROM sleep_sessions WHERE user_id = $1`)
    expect(same.id).toBe(id)
    expect(same.sleep_end.toISOString()).toBe('2026-10-09T20:50:00.000Z')
    expect(same.date).toBe('2026-10-10')

    const { handleOuraWebhookEvent } = await import('@/lib/oura/cloud/webhook')
    expect(await handleOuraWebhookEvent({ repo, config: CONFIG, heartRate: () => {} }, { event_type: 'delete', data_type: 'sleep', object_id: 'sl-1', user_id: OURA_USER }))
      .toEqual({ result: 'deleted', tombstoned: 1 })
    const gone = await one(`SELECT deleted_at FROM sleep_sessions WHERE user_id = $1`)
    expect(gone.deleted_at).not.toBeNull()
  })

  it('keeps a workout\'s reviewed flag when Oura re-sends it', async () => {
    await webhookAll()
    expect(await repo.markOuraWorkoutReviewed(USER, 'wo-1')).toBe(true)
    await webhookAll()
    expect((await one(`SELECT reviewed FROM oura_workouts WHERE user_id = $1`)).reviewed).toBe(true)
  })

  // #2895 review, item 3: Oura has no heart-rate webhook; sleep, activity and workout events start a
  // catch-up from the newest Cloud point, which lands through the same cover-aware upsert.
  it('catches heart rate up after the events that mean the ring synced', async () => {
    expect(await webhookAll()).toEqual([USER, USER, USER])
    const { catchUpOuraCloudHeartRate } = await import('@/lib/oura/cloud/webhook')
    const now = Date.parse('2026-10-12T00:00:00Z')
    expect(await catchUpOuraCloudHeartRate({ repo, config: CONFIG }, USER, now)).toBe(2)
    const rows = (await pool.query(`SELECT bpm, source FROM oura_heartrate WHERE user_id = $1 ORDER BY timestamp`, [USER])).rows
    expect(rows).toEqual([{ bpm: 61, source: 'oura_cloud' }, { bpm: 64, source: 'oura_cloud' }])
    expect((await repo.getLatestOuraCloudHeartrateAt(USER, new Date(now - 7 * 86_400_000)))?.toISOString()).toBe('2026-10-10T00:05:00.000Z')
    expect(await repo.getLatestOuraCloudHeartrateAt(USER, new Date('2026-10-11T00:00:00Z'))).toBeNull()
  })

  it('writes Cloud heart rate only where no ring or strap row covers it', async () => {
    await repo.upsertOuraHeartrate(USER, [{ timestamp: new Date('2026-10-10T00:06:00Z'), bpm: 70, source: 'ble' }])
    const n = await repo.upsertOuraCloudHeartrate(USER, [
      { timestamp: new Date('2026-10-09T23:50:00Z'), bpm: 61 },
      { timestamp: new Date('2026-10-10T00:05:00Z'), bpm: 64 },
    ], 'Australia/Brisbane')
    expect(n).toBe(1)
    const rows = (await pool.query(`SELECT timestamp, bpm, source FROM oura_heartrate WHERE user_id = $1 ORDER BY timestamp`, [USER])).rows
    expect(rows.map(r => [r.timestamp.toISOString(), r.bpm, r.source])).toEqual([
      ['2026-10-09T23:50:00.000Z', 61, 'oura_cloud'],
      ['2026-10-10T00:06:00.000Z', 70, 'ble'],
    ])
  })

  it('backfills a date range idempotently, and a dry run writes nothing', async () => {
    const { backfillOuraCloud } = await import('@/lib/oura/cloud/backfill')
    const opts = { from: '2026-10-01', to: '2026-10-12', heartRate: true, tz: 'Australia/Brisbane' }
    const dry = await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...opts, dryRun: true })
    expect(dry.ok && dry.report.counts).toMatchObject({ dailyRows: 1, bodyRows: 1, sleepWritten: 1, workouts: 1 })
    expect(Number((await one(`SELECT count(*) AS n FROM oura_daily WHERE user_id = $1`)).n)).toBe(0)
    expect(Number((await one(`SELECT count(*) AS n FROM oura_heartrate WHERE user_id = $1`)).n)).toBe(0)

    const count = async () => Object.fromEntries(await Promise.all(['oura_daily', 'body_metrics', 'sleep_sessions', 'oura_workouts', 'oura_heartrate']
      .map(async t => [t, Number((await pool.query(`SELECT count(*) AS n FROM ${t} WHERE user_id = $1`, [USER])).rows[0].n)])))
    const first = await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...opts, dryRun: false })
    expect(first.ok && first.report.stoppedEarly).toBeNull()
    const after1 = await count()
    expect(after1).toEqual({ oura_daily: 1, body_metrics: 1, sleep_sessions: 1, oura_workouts: 1, oura_heartrate: 2 })
    await backfillOuraCloud({ repo, config: CONFIG }, USER, { ...opts, dryRun: false })
    expect(await count()).toEqual(after1)
  })
})
