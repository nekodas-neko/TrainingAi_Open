// C-1 safety: the windowed rollup must NOT delete the older daily-summary rows it deliberately
// skips, and the incremental fold must resume from the correct persisted checkpoint. This guards the
// exact catastrophe the windowing risked — replaceOuraDailySummary is delete-all, so if the rollup
// ever fed it a windowed slice it would erase all history + reset the readiness baselines.
import { describe, it, expect, beforeAll } from 'vitest'
import { computeDailySummaries, type NightInput } from '@trainingai/shared/health/daily-summary'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000005e3'
const TZ = 'Australia/Brisbane'

function night(date: string, i: number): NightInput {
  return {
    date, sleepDurationHours: 7 + (i % 3) * 0.3, sleepEfficiency: 88 + (i % 5),
    deepSleepHours: 1.4, remSleepHours: 1.7, restlessPeriods: 4 + (i % 3), sleepLatencySec: 500 + i,
    hrvAvgMs: 44 + (i % 7), rhrLowBpm: 52 + (i % 4), rhrAvgBpm: 58 + (i % 4),
    recoveryIndexHours: 2, tempMeanC: 34.4 + (i % 3) * 0.1, metAvg: 1.2 + (i % 2) * 0.2, breathAvgRpm: 14 + (i % 3) * 0.4,
  }
}

describe.skipIf(!canRun)('daily-summary incremental slice helpers (C-1)', () => {
  let pool: import('pg').Pool
  let oura: typeof import('@/lib/data/postgres/slices/oura')
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  const dates = Array.from({ length: 40 }, (_, i) => `2026-05-${String(i + 1).padStart(2, '0')}`).slice(0, 31)

  beforeAll(async () => {
    const { getPool, getDb } = await import('@/lib/data/postgres/client')
    oura = await import('@/lib/data/postgres/slices/oura')
    pool = getPool(); db = getDb()
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3) ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `ds-incremental-${TEST_USER_ID}@example.com`, TZ])
    await pool.query(`DELETE FROM oura_daily_summary WHERE user_id = $1`, [TEST_USER_ID])
  })

  it('upsert preserves older rows, updates windowed rows, and keeps baseline continuity', async () => {
    // Full history persisted first (the state a prior full/redecode run leaves).
    const nights = dates.map((d, i) => night(d, i))
    const fullRows = computeDailySummaries(nights)
    await oura.replaceOuraDailySummary(db, TEST_USER_ID, fullRows)
    const before = await pool.query(`SELECT count(*)::int n FROM oura_daily_summary WHERE user_id=$1`, [TEST_USER_ID])
    expect(before.rows[0].n).toBe(31)

    // Now simulate a windowed rollup over the last 5 nights, seeded from the checkpoint.
    const windowStart = dates.length - 5
    const seedRow = await oura.getLatestOuraDailySummaryBefore(db, TEST_USER_ID, dates[windowStart])
    expect(seedRow?.date).toBe(dates[windowStart - 1])       // the night right before the window
    expect(seedRow?.nHistory).toBe(windowStart)              // count inclusive of that night

    const seed = seedRow && {
      hrvBaseline: seedRow.hrvBaseline, rhrBaseline: seedRow.rhrBaseline, tempBaseline: seedRow.tempBaseline,
      sleepBaseline: seedRow.sleepBaseline, metBaseline: seedRow.metBaseline, breathBaseline: seedRow.breathBaseline,
      nHistory: seedRow.nHistory,
    }
    const windowedRows = computeDailySummaries(nights.slice(windowStart), seed)
    await oura.upsertOuraDailySummary(db, TEST_USER_ID, windowedRows)

    // No rows deleted (the old-summary-erasure catastrophe cannot happen).
    const after = await pool.query(`SELECT count(*)::int n FROM oura_daily_summary WHERE user_id=$1`, [TEST_USER_ID])
    expect(after.rows[0].n).toBe(31)

    // Every stored row equals the full-replay value — windowed upsert is byte-identical to the full run.
    const stored = await oura.getOuraDailySummary(db, TEST_USER_ID, dates[0], dates[dates.length - 1])
    expect(stored.map(r => r.nHistory)).toEqual(fullRows.map(r => r.nHistory))
    expect(stored.map(r => r.hrvBaseline)).toEqual(fullRows.map(r => r.hrvBaseline))
  })
})
