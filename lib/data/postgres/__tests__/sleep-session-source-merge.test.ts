// saveSleepSession used to be a bare onConflictDoNothing with no source_map, so a Health Connect
// night was a rank-0 first-write-wins writer while every other health write went through the
// per-field rank merge (Q-43). These assert the two orderings converge on the same row — which is
// exactly what first-write-wins cannot do.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000f0c3'
const SLEEP_START = new Date('2026-07-20T12:00:00.000Z')
const SLEEP_END   = new Date('2026-07-20T19:30:00.000Z')
const DAY = '2026-07-21'

describe.skipIf(!canRun)('saveSleepSession — per-field source merge', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID, `sleep-source-${TEST_USER_ID}@example.com`])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [TEST_USER_ID])
  })

  async function reset() {
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [TEST_USER_ID])
  }

  const hcNight = {
    date: DAY,
    sleepStart: SLEEP_START,
    sleepEnd: SLEEP_END,
    durationHours: 7.0,
    deepSleepHours: 1.0,
    remSleepHours: 1.2,
    lightSleepHours: 4.8,
    awakHours: 0.5,
  }

  const ringNight = {
    ouraId: 'ring-night-1',
    date: DAY,
    sleepStart: SLEEP_START,
    sleepEnd: SLEEP_END,
    durationHours: 7.4,
    deepSleepHours: 1.6,
    remSleepHours: 1.5,
    lightSleepHours: 4.3,
    awakHours: 0.1,
    averageHrvMs: 62,
    lowestHeartRate: 48,
  }

  async function row() {
    const { rows } = await pool.query(
      `SELECT duration_hours, deep_sleep_hours, average_hrv_ms, lowest_heart_rate, source_map
         FROM sleep_sessions WHERE user_id = $1 AND sleep_start = $2`,
      [TEST_USER_ID, SLEEP_START])
    return rows[0]
  }

  it('lets the ring correct a Health Connect night written first', async () => {
    await reset()
    await repo.saveSleepSession(TEST_USER_ID, hcNight, 'health_connect')
    await repo.upsertOuraSleep(TEST_USER_ID, [ringNight], 'oura_ble')

    const r = await row()
    expect(Number(r.duration_hours)).toBeCloseTo(7.4, 3)
    expect(Number(r.deep_sleep_hours)).toBeCloseTo(1.6, 3)
    expect(r.source_map.duration_hours).toBe('oura_ble')
  })

  it('keeps the ring values when Health Connect writes the same night afterwards', async () => {
    await reset()
    await repo.upsertOuraSleep(TEST_USER_ID, [ringNight], 'oura_ble')
    await repo.saveSleepSession(TEST_USER_ID, hcNight, 'health_connect')

    const r = await row()
    // The distinguishing assertion: under first-write-wins this row would still read 7.4 too,
    // but the previous test would have read 7.0. Both orderings landing on the ring's value is
    // only possible with a rank merge.
    expect(Number(r.duration_hours)).toBeCloseTo(7.4, 3)
    expect(Number(r.deep_sleep_hours)).toBeCloseTo(1.6, 3)
    expect(r.source_map.duration_hours).toBe('oura_ble')
  })

  it('lets Health Connect fill fields the ring never wrote, without clobbering the ring', async () => {
    await reset()
    await repo.upsertOuraSleep(TEST_USER_ID, [{ ...ringNight, deepSleepHours: null }], 'oura_ble')
    await repo.saveSleepSession(TEST_USER_ID, hcNight, 'health_connect')

    const r = await row()
    expect(Number(r.deep_sleep_hours)).toBeCloseTo(1.0, 3)     // filled from Health Connect
    expect(r.source_map.deep_sleep_hours).toBe('health_connect')
    expect(Number(r.duration_hours)).toBeCloseTo(7.4, 3)        // ring still wins where it wrote
    expect(Number(r.average_hrv_ms)).toBeCloseTo(62, 3)
  })

  it('stamps provenance on a first Health Connect write', async () => {
    await reset()
    await repo.saveSleepSession(TEST_USER_ID, hcNight, 'health_connect')

    const r = await row()
    expect(r.source_map.duration_hours).toBe('health_connect')
    expect(r.source_map.deep_sleep_hours).toBe('health_connect')
    // Never stamped for a column the write had no value for.
    expect(r.source_map.average_hrv_ms).toBeUndefined()
  })

  it('carries a Health Connect hypnogram through to sleep_phase_5_min', async () => {
    await reset()
    await repo.saveSleepSession(TEST_USER_ID, { ...hcNight, sleepPhase5Min: '2211' }, 'health_connect')

    const { rows } = await pool.query(
      `SELECT sleep_phase_5_min, source_map FROM sleep_sessions WHERE user_id = $1 AND sleep_start = $2`,
      [TEST_USER_ID, SLEEP_START])
    expect(rows[0].sleep_phase_5_min).toBe('2211')
    expect(rows[0].source_map.sleep_phase_5_min).toBe('health_connect')
  })
})
