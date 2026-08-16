// Phase-2 durability A3 (server push half): sleep_sessions becomes a push-capable sync domain.
// The push delegates to the shared upsertOuraSleep with source='oura_ble', so it does the
// sourceMap/mergeSet per-field rank merge — it must NOT stomp a higher-ranked manual/Samsung-Health
// field. Also verifies the pull already carries the Oura columns, idempotent re-push, and that a
// mutation missing the natural key (ouraId/sleepStart) is quarantined (per-item error), not wedged.
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000d016'
const TZ = 'Australia/Brisbane'
const DAY = '2026-07-08'
const SLEEP_START = '2026-07-07T22:30:00.000Z'
const SLEEP_END = '2026-07-08T06:15:00.000Z'
const OURA_ID = 'ble:2026-07-08:test'

const PAYLOAD = {
  ouraId: OURA_ID, sleepStart: SLEEP_START, sleepEnd: SLEEP_END,
  durationHours: 7.5, deepSleepHours: 1.4, remSleepHours: 1.8, lightSleepHours: 4.3, awakHours: 0.4,
  efficiency: 92, onsetLatencySec: 540, averageHrvMs: 44, avgHeartRate: 54, lowestHeartRate: 48,
  restlessPeriods: 12, sleepScore: 84, respiratoryRate: 14.2, sleepPhase5Min: 'DLRWDL', timeInBedHours: 7.9,
}

describe.skipIf(!canRun)('sleep_session push offline-sync (A3 server)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const sleepRow = async () => {
    const { rows } = await pool.query(
      `SELECT oura_id, average_hrv_ms, avg_heart_rate, sleep_score, source_map
         FROM sleep_sessions WHERE user_id = $1 AND sleep_start = $2`,
      [TEST_USER_ID, SLEEP_START],
    )
    return rows[0] as { oura_id: string; average_hrv_ms: number | null; avg_heart_rate: number | null; sleep_score: number | null; source_map: Record<string, string> | null } | undefined
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `oura-sleep-${TEST_USER_ID}@example.com`, TZ],
    )
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [TEST_USER_ID])
  })

  it('push lands the BLE sleep row with Oura columns + source_map=oura_ble', async () => {
    const res = await repo.pushMutations(TEST_USER_ID, [
      { id: 's1', domain: 'sleep_session', date: DAY, payload: PAYLOAD },
    ])
    expect(res.errors).toEqual([])
    expect(res.processed).toBe(1)
    const row = await sleepRow()
    expect(row?.oura_id).toBe(OURA_ID)
    expect(Number(row?.average_hrv_ms)).toBeCloseTo(44)
    expect(row?.sleep_score).toBe(84)
    expect(row?.source_map?.average_hrv_ms).toBe('oura_ble')
  })

  it('getSyncDelta returns the sleep row with the Oura columns (pull already complete)', async () => {
    const delta = await repo.getSyncDelta(TEST_USER_ID, new Date(0), null)
    const row = (delta.sleepSessions as { ouraId?: string; averageHrvMs?: number }[])
      .find((r) => r.ouraId === OURA_ID)
    expect(row).toBeTruthy()
    expect(Number(row!.averageHrvMs)).toBeCloseTo(44)
  })

  it('source-merge: a re-push does not stomp a higher-ranked manual field', async () => {
    // Seed a manual avg_heart_rate on the same night (rank 4). The oura_ble push (rank 3) must NOT
    // overwrite it, but MUST still fill a field the manual write didn't set (respiratory_rate).
    await repo.upsertOuraSleep(TEST_USER_ID, [{
      ouraId: OURA_ID, date: DAY, sleepStart: new Date(SLEEP_START), sleepEnd: new Date(SLEEP_END),
      avgHeartRate: 60, // manual truth
    }], 'manual')
    await repo.pushMutations(TEST_USER_ID, [
      { id: 's2', domain: 'sleep_session', date: DAY, payload: { ...PAYLOAD, avgHeartRate: 54, respiratoryRate: 15.1 } },
    ])
    const row = await sleepRow()
    expect(Number(row?.avg_heart_rate)).toBeCloseTo(60)      // manual preserved (not stomped)
    expect(row?.source_map?.avg_heart_rate).toBe('manual')
    const { rows } = await pool.query(
      `SELECT respiratory_rate FROM sleep_sessions WHERE user_id = $1 AND sleep_start = $2`,
      [TEST_USER_ID, SLEEP_START],
    )
    expect(Number(rows[0].respiratory_rate)).toBeCloseTo(15.1) // oura_ble filled the manual-untouched field
  })

  it('quarantines a mutation missing the natural key (does not wedge the queue)', async () => {
    const res = await repo.pushMutations(TEST_USER_ID, [
      { id: 'bad', domain: 'sleep_session', date: DAY, payload: { averageHrvMs: 40 } }, // no ouraId/sleepStart
      { id: 's3', domain: 'sleep_session', date: DAY, payload: PAYLOAD },               // valid sibling
    ])
    expect(res.errors.map(e => e.id)).toContain('bad')
    expect(res.processed).toBe(1) // the valid sibling still processed — one bad mutation doesn't block it
  })
})
