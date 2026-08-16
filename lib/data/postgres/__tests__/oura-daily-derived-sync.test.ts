// Phase-2 durability A2 (server half): oura_daily_derived as a bidirectional offline-sync domain.
// Verifies the push branch (pushMutations → shared COALESCE upsertOuraDailyDerived) parses the 7
// JSONB columns back from the TEXT mirror, that getSyncDelta returns the row with JSONB stringified
// for the client mirror, and — the COALESCE guard — that a partial re-push never nulls a good value.
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000d015'
const TZ = 'Australia/Brisbane'
const DAY = '2026-07-08'

// The local mirror stores JSONB columns as TEXT, so the outbox payload carries them stringified.
const FULL_PAYLOAD = {
  source: 'oura_ble',
  modelVersions: JSON.stringify({ sleepnet: '1.2.0' }),
  sleepScore: 84, sleepContributors: JSON.stringify({ deep: 70 }),
  readinessScore: 78, readinessContributors: JSON.stringify({ hrv: 60 }), readinessSource: 'ble',
  activityScore: null, activityContributors: null, activeCaloriesEst: null,
  trainingLoadOts: 42.5, trainingLoadHigh: true,
  recoveryIndexHours: 6.1, wornHoursBle: 21.3, nightHrvBaselineMs: 44.2,
  illnessFlag: 'none', illnessScore: 12, illnessBiomarkers: JSON.stringify({ temp: 0.1 }),
  daytimeStressScaled: 33, stressHighMinutes: 90, recoveryHighMinutes: 120,
  chronicStressScore: 41, chronicStressContributors: JSON.stringify({ trend: 'flat' }),
  resilienceLevel: 3, resilienceDailyStress: 1.2, resilienceDailyRestorativeTime: 4.5,
  resilienceDailySleepRecovery: 2.1, resilienceGranular: 3.4, resilienceConfidence: 0.8,
  bdiDerived: 5.5, vascularAge: null, pwv: null,
  bodyComp: JSON.stringify({ ffm: 62 }),
}

describe.skipIf(!canRun)('oura_daily_derived offline-sync round-trip (A2 server)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `oura-derived-${TEST_USER_ID}@example.com`, TZ],
    )
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [TEST_USER_ID])
  })

  it('push parses the JSONB columns and lands the row', async () => {
    const res = await repo.pushMutations(TEST_USER_ID, [
      { id: 'd1', domain: 'oura_daily_derived', date: DAY, payload: FULL_PAYLOAD },
    ])
    expect(res.errors).toEqual([])
    expect(res.processed).toBe(1)

    const { rows } = await pool.query(
      `SELECT illness_score, resilience_level, training_load_high, sleep_contributors, body_comp
         FROM oura_daily_derived WHERE user_id = $1 AND day = $2`,
      [TEST_USER_ID, DAY],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].illness_score).toBe(12)
    expect(Number(rows[0].resilience_level)).toBeCloseTo(3)
    expect(rows[0].training_load_high).toBe(true)
    // JSONB landed as a real object (pg returns parsed jsonb), not a double-encoded string.
    expect(rows[0].sleep_contributors).toEqual({ deep: 70 })
    expect(rows[0].body_comp).toEqual({ ffm: 62 })
  })

  it('getSyncDelta returns the row with JSONB stringified for the TEXT mirror', async () => {
    const delta = await repo.getSyncDelta(TEST_USER_ID, new Date(0), null)
    const row = (delta.ouraDailyDerived ?? []).find((r) => (r as { day: string }).day === DAY) as Record<string, unknown> | undefined
    expect(row).toBeTruthy()
    expect(row!.illnessScore).toBe(12)
    expect(typeof row!.sleepContributors).toBe('string')            // stringified for the client
    expect(JSON.parse(row!.sleepContributors as string)).toEqual({ deep: 70 })
    expect(typeof row!.updatedAt).toBe('string')
  })

  it('field coverage: the push payload carries every DERIVED_COLS column (drift tripwire)', async () => {
    // If a new derived column is added to DERIVED_COLS but not to the pushMutations branch / this
    // payload, the backup would silently drop it. Assert the payload covers every column key.
    const { DERIVED_COLS } = await import('@/lib/data/postgres/slices/oura')
    const payloadKeys = new Set(Object.keys(FULL_PAYLOAD))
    const missing = Object.keys(DERIVED_COLS).filter((k) => !payloadKeys.has(k))
    expect(missing).toEqual([])
  })

  it('COALESCE: a partial re-push updates only its fields and never nulls the rest', async () => {
    // Re-push only illness_score; everything else absent (null). COALESCE must preserve them.
    await repo.pushMutations(TEST_USER_ID, [
      { id: 'd2', domain: 'oura_daily_derived', date: DAY, payload: { illnessScore: 20 } },
    ])
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n, max(illness_score) AS illness, max(resilience_level) AS res,
              bool_or(training_load_high) AS tlh
         FROM oura_daily_derived WHERE user_id = $1 AND day = $2`,
      [TEST_USER_ID, DAY],
    )
    expect(rows[0].n).toBe(1)                    // in place, no duplicate
    expect(rows[0].illness).toBe(20)             // updated
    expect(Number(rows[0].res)).toBeCloseTo(3)   // preserved (not nulled by the partial push)
    expect(rows[0].tlh).toBe(true)               // preserved
  })
})
