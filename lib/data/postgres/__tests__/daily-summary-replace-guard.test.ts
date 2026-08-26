// Q-528 — `replaceOuraDailySummary` deletes every one of the user's rows and only THEN returns
// early on an empty input, so a full-history pass that computed nothing commits a wipe and returns
// successfully. No error, no log.
//
// The entry that filed this said outright that the mechanism was "read from source and not
// reproduced", and its predecessor's central claim had already been retracted once for being read
// (`n_live_tup`, a planner estimate) rather than counted. So these tests reproduce all three
// failures against a real Postgres before anything is changed.
//
// Three defects, one function:
//   1. delete-then-guard      — an empty input wipes the table
//   2. no transaction         — a failed insert leaves the table wiped (the delete already committed)
//   3. no ON CONFLICT arm     — a repeated (user_id, date) raises 23505 and kills the whole insert
//
// `replaceDaytimeStressBuckets`, in this same file, already has all three right, and its own comment
// says why: "the delete and the insert share a transaction so a day is never briefly empty for a
// concurrent reader."
//
// Runs only against a local dev Postgres; skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000528001'

function summaryRow(date: string, hrvAvgMs: number | null = 50) {
  return {
    date,
    sleepDurationHours: 7.5, sleepEfficiency: 90, deepSleepHours: 1.2, remSleepHours: 1.5,
    restlessPeriods: 3, sleepLatencySec: 600, hrvAvgMs, rhrLowBpm: 50, rhrAvgBpm: 55,
    recoveryIndexHours: 4, tempMeanC: 36.2, tempDevC: 0.1, metAvg: 1.4, breathAvgRpm: 14,
    hrvBaseline: null, rhrBaseline: null, tempBaseline: null, sleepBaseline: null,
    metBaseline: null, breathBaseline: null, nHistory: 1,
  } as unknown as import('@/lib/data/repository').OuraDailySummaryRow
}

describe.skipIf(!canRun)('replaceOuraDailySummary never commits a wipe (Q-528)', () => {
  let pool: import('pg').Pool
  let db: Awaited<ReturnType<typeof import('@/lib/data/postgres/client').getDb>>
  let oura: typeof import('@/lib/data/postgres/slices/oura')

  beforeAll(async () => {
    const { getPool, getDb } = await import('@/lib/data/postgres/client')
    oura = await import('@/lib/data/postgres/slices/oura')
    pool = getPool(); db = await getDb()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [USER, `daily-summary-guard-${USER}@example.com`],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_daily_summary WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  const count = async () => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM oura_daily_summary WHERE user_id = $1`, [USER])
    return rows[0].n as number
  }

  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_daily_summary WHERE user_id = $1`, [USER])
    // Three days of history, written the way the incremental rollup writes them.
    await oura.upsertOuraDailySummary(db, USER, [
      summaryRow('2026-03-01'), summaryRow('2026-03-02'), summaryRow('2026-03-03'),
    ])
    expect(await count()).toBe(3)
  })

  // Defect 1. This is the entry's finding, and the reason it is filed as latent rather than an
  // incident: it needs a full-history pass that assembled no nights.
  it('an empty input leaves the stored history alone', async () => {
    await oura.replaceOuraDailySummary(db, USER, [])
    expect(await count()).toBe(3)
  })

  // Defect 3. The UNIQUE is (user_id, date) and the insert carries no ON CONFLICT arm, so one
  // repeated day rejects every row in the statement — the same "a duplicate takes its neighbours
  // down" shape as Q-280, a different SQLSTATE.
  it('a repeated date in the input does not reject the whole replace', async () => {
    await oura.replaceOuraDailySummary(db, USER, [
      summaryRow('2026-04-01', 41),
      summaryRow('2026-04-02', 42),
      summaryRow('2026-04-01', 43), // repeat of the first
    ])
    const { rows } = await pool.query(
      `SELECT date::text AS date, hrv_avg_ms FROM oura_daily_summary WHERE user_id = $1 ORDER BY date`,
      [USER])
    expect(rows.map(r => r.date)).toEqual(['2026-04-01', '2026-04-02'])
    expect(rows[0].hrv_avg_ms).toBe(43) // last value wins, as the replace intends
  })

  // Defect 2. The delete and the insert were two statements, so a rejected insert left the delete
  // committed and the user with nothing. Driven by a row the insert must refuse: `date` is NOT NULL.
  it('a failing insert rolls the delete back rather than leaving the table empty', async () => {
    const poison = { ...summaryRow('2026-05-01'), date: null } as unknown as
      import('@/lib/data/repository').OuraDailySummaryRow
    await expect(oura.replaceOuraDailySummary(db, USER, [poison])).rejects.toThrow()
    expect(await count()).toBe(3) // the pre-existing history survives the failure
  })

  // The function's actual job still has to work.
  it('still replaces the whole history when it is given one', async () => {
    await oura.replaceOuraDailySummary(db, USER, [summaryRow('2026-06-01'), summaryRow('2026-06-02')])
    const { rows } = await pool.query(
      `SELECT date::text AS date FROM oura_daily_summary WHERE user_id = $1 ORDER BY date`, [USER])
    expect(rows.map(r => r.date)).toEqual(['2026-06-01', '2026-06-02'])
  })

  // The delete is user-scoped and must stay that way — a full-history pass for one user cannot be
  // allowed to clear another's.
  it('does not touch another user\'s rows', async () => {
    const OTHER = '00000000-0000-4000-8000-000000528002'
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [OTHER, `daily-summary-guard-${OTHER}@example.com`])
    await oura.upsertOuraDailySummary(db, OTHER, [summaryRow('2026-03-01')])
    try {
      await oura.replaceOuraDailySummary(db, USER, [summaryRow('2026-07-01')])
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM oura_daily_summary WHERE user_id = $1`, [OTHER])
      expect(rows[0].n).toBe(1)
    } finally {
      await pool.query(`DELETE FROM oura_daily_summary WHERE user_id = $1`, [OTHER])
      await pool.query(`DELETE FROM users WHERE id = $1`, [OTHER])
    }
  })
})
