// TN-64(a) — the ACWR column has to survive the WHOLE mapper chain, not just exist.
//
// `earlyDeloadRecommended` fires on `score < 45 AND acwr > 1.2` and has never fired in 118
// sessions. The score half is stored; the ACWR half was computed on every readiness read and
// discarded, so "the threshold never opened" and "the gate was never reached" read identically
// from the data. Widening the gate (part b) cannot be validated until this number is recorded.
//
// The failure this pins is the one CLAUDE.md names by hand: a new column that reaches the schema
// but misses a row→object mapper fails SILENTLY, as "the save doesn't persist". `acwr` has to be
// in three separate places — the column map, the row mapper, and the row type — and a write
// followed by a read is the only thing that proves all three, because missing any one of them
// still compiles and still writes.
//
// Runs only against a local dev Postgres — skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000c064'
const DAY = '2026-09-21'

describe.skipIf(!canRun)('the stored ACWR survives a write and a read (TN-64a)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, `tn64-${USER}@example.com`])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [USER])
  })

  const read = async () => (await repo.getOuraDailyDerived(USER, DAY, DAY))[0]

  it('a written ACWR reads back as the same number', async () => {
    await repo.upsertOuraDailyDerived(USER, DAY, { acwr: 1.37 })
    expect((await read())?.acwr).toBe(1.37)
  })

  it('it rides the same patch as the readiness score, which is how the payload writes it', async () => {
    // The persist site pushes one `readiness` pillar patch carrying both halves of the gate, so
    // they land on one row for one day and cannot disagree about the inputs of that day.
    await repo.upsertOuraDailyDerived(USER, DAY, { readinessScore: 41, acwr: 1.44 })
    const row = await read()
    expect(row?.readinessScore).toBe(41)
    expect(row?.acwr).toBe(1.44)
  })

  it('a later write that omits ACWR does NOT wipe it — the upsert is COALESCE', async () => {
    // Another pillar writing the same row (sleep, activity, body_comp) must not clear a number it
    // knows nothing about. This is the property the shared upsert already guarantees; it is pinned
    // here because ACWR is written from ONE site, so a regression would leave the column
    // permanently null and look like "the readiness path stopped running".
    await repo.upsertOuraDailyDerived(USER, DAY, { acwr: 1.21 })
    await repo.upsertOuraDailyDerived(USER, DAY, { sleepScore: 77 })
    const row = await read()
    expect(row?.acwr).toBe(1.21)
    expect(row?.sleepScore).toBe(77)
  })

  it('an unwritten ACWR is null, not zero', async () => {
    // Zero is a real ACWR — the bottom of the range, a genuine training state — so a default would
    // enter later correlations as data. Every day before this shipped must read as "not recorded".
    await repo.upsertOuraDailyDerived(USER, DAY, { readinessScore: 60 })
    expect((await read())?.acwr).toBeNull()
  })
})
