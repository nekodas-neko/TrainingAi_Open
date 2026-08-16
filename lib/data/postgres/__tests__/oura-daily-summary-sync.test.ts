// Phase-2 durability A1 (server half): oura_daily_summary as a bidirectional offline-sync domain.
// Verifies the push branch (pushMutations → shared upsertOuraDailySummary) lands every column incl.
// the rolling EMA baselines, and that getSyncDelta returns it — with baselines intact — under both
// the default 90-day window and full-history restore (windowDays=null). This is the round-trip the
// device's backup + restore depends on.
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000d014'
const TZ = 'Australia/Brisbane'
const DAY = '2026-07-08'

// Flat camelCase payload (mirrors the Drizzle column props + the local mirror columns).
const PAYLOAD = {
  sleepDurationHours: 7.5, sleepEfficiency: 92, deepSleepHours: 1.4, remSleepHours: 1.8,
  restlessPeriods: 12, sleepLatencySec: 540, hrvAvgMs: 44, rhrLowBpm: 48.5, rhrAvgBpm: 52.1,
  recoveryIndexHours: 6.2, tempMeanC: 33.4, tempDevC: -0.1, metAvg: 1.4, breathAvgRpm: 14.2,
  hrvBaselineMeanX8: 352, hrvBaselineDevX8: 40,
  rhrBaselineMeanX8: 388, rhrBaselineDevX8: 24,
  tempBaselineMeanX8: 268, tempBaselineDevX8: 8,
  sleepBaselineMeanX8: 60, sleepBaselineDevX8: 6,
  metBaselineMeanX8: 11, metBaselineDevX8: 2,
  breathBaselineMeanX8: 114, breathBaselineDevX8: 5,
  nHistory: 21,
}

describe.skipIf(!canRun)('oura_daily_summary offline-sync round-trip (A1 server)', () => {
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
      [TEST_USER_ID, `oura-summary-${TEST_USER_ID}@example.com`, TZ],
    )
    await pool.query(`DELETE FROM oura_daily_summary WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_daily_summary WHERE user_id = $1`, [TEST_USER_ID])
  })

  it('push lands every metric + baseline column in the server table', async () => {
    const res = await repo.pushMutations(TEST_USER_ID, [
      { id: 'm1', domain: 'oura_daily_summary', date: DAY, payload: PAYLOAD },
    ])
    expect(res.errors).toEqual([])
    expect(res.processed).toBe(1)

    const { rows } = await pool.query(
      `SELECT sleep_duration_hours, hrv_avg_ms, rhr_low_bpm, hrv_baseline_mean_x8, hrv_baseline_dev_x8,
              breath_baseline_mean_x8, n_history FROM oura_daily_summary WHERE user_id = $1 AND date = $2`,
      [TEST_USER_ID, DAY],
    )
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].sleep_duration_hours)).toBeCloseTo(7.5)
    expect(Number(rows[0].hrv_avg_ms)).toBeCloseTo(44)
    expect(Number(rows[0].rhr_low_bpm)).toBeCloseTo(48.5)
    expect(rows[0].hrv_baseline_mean_x8).toBe(352)
    expect(rows[0].hrv_baseline_dev_x8).toBe(40)
    expect(rows[0].breath_baseline_mean_x8).toBe(114)
    expect(rows[0].n_history).toBe(21)
  })

  it('getSyncDelta returns the pushed row with baselines intact (default + full-history)', async () => {
    const find = (d: { ouraDailySummary?: unknown[] }) =>
      (d.ouraDailySummary ?? []).find((r) => (r as { day: string }).day === DAY) as Record<string, unknown> | undefined

    // Full-history restore (windowDays=null) from epoch.
    const full = await repo.getSyncDelta(TEST_USER_ID, new Date(0), null)
    const row = find(full)
    expect(row).toBeTruthy()
    expect(row!.day).toBe(DAY)
    expect(row!.hrvAvgMs).toBeCloseTo(44)
    expect(row!.hrvBaselineMeanX8).toBe(352)
    expect(row!.nHistory).toBe(21)
    expect(typeof row!.updatedAt).toBe('string') // ISO-coerced for the wire

    // Default 90-day window (the row was just written, so it's inside the floor).
    const recent = await repo.getSyncDelta(TEST_USER_ID, new Date(0))
    expect(find(recent)).toBeTruthy()
  })

  it('a second push of the same day upserts in place (no duplicate, history-safe)', async () => {
    await repo.pushMutations(TEST_USER_ID, [
      { id: 'm2', domain: 'oura_daily_summary', date: DAY, payload: { ...PAYLOAD, hrvAvgMs: 47 } },
    ])
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n, max(hrv_avg_ms) AS hrv FROM oura_daily_summary WHERE user_id = $1 AND date = $2`,
      [TEST_USER_ID, DAY],
    )
    expect(rows[0].n).toBe(1)               // in place, not a duplicate
    expect(Number(rows[0].hrv)).toBeCloseTo(47) // updated value
  })
})
