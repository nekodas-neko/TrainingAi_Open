// Q-270: `training_load_ots` has a producer and is 0 of 104 days in production.
//
// The entry has now been wrong twice about why, and both times the gap was the same: **nobody had
// run the persist.** Its own note says so — *"the persist itself is unproven locally, since the seed
// carries no `ble-derived` readiness, so the route gates before the write"* — and the 2026-08-15 fix
// was shipped against that unproven assumption and did not take.
//
// This is that proof. It drives `computeTrainingStress` over a seeded day that satisfies all four
// gates, then `upsertOuraDailyDerived` with the result, exactly as `app/api/training-stress/route.ts`
// does, and asserts the column actually holds a number afterwards.
//
// **What it deliberately does NOT prove:** that anything calls the route in production. That is the
// open half of Q-270 and no unit test can reach it — measured 2026-08-30, all four gates pass on all
// eight most recent production days and `error_events` holds no `/api/training-stress` row, so the
// route is neither failing nor succeeding. It is not being called.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { computeTrainingStress, metGridFromDaytimeSamples } from '@trainingai/shared/health/training-stress'
import { hasRealConstants } from '@/lib/oura-models/__fixtures__/real-constants'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000270001'
const TZ = 'Australia/Brisbane'
const DAY = '2026-06-15'

// The gate is `metsPerMinute.length < 720 || validMin < 360` — twelve hours of grid and six of
// values. Production days span ~1,425 minutes with ~1,146 values, so this seeds the same shape:
// 96 events fifteen minutes apart, each carrying its fifteen minute-bins.
const EVENTS = 96
const BINS_PER_EVENT = 15

describe.skipIf(!canRun)('training-stress persists its OTS once the gates pass (Q-270)', () => {
  let pool: import('pg').Pool
  let db: typeof import('@/lib/data/postgres/client').getDb extends () => infer D ? D : never

  beforeAll(async () => {
    const { getPool, getDb } = await import('@/lib/data/postgres/client')
    pool = getPool()
    db = getDb()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, date_of_birth, sex, height_cm)
       VALUES ($1, $2, 'x', $3, '1993-01-01', 'male', 175)
       ON CONFLICT (id) DO UPDATE SET date_of_birth = EXCLUDED.date_of_birth, sex = EXCLUDED.sex`,
      [TEST_USER_ID, `training-stress-${TEST_USER_ID}@example.com`, TZ],
    )
    for (const t of ['oura_daily_derived', 'oura_daily_summary', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of ['oura_daily_derived', 'oura_daily_summary', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  /** The same four inputs the route assembles, with every gate satisfied. */
  function stressInputs() {
    const dayStartMs = Date.UTC(2026, 5, 14, 14, 0, 0) // 2026-06-15 00:00 Brisbane
    const samples: { tsMs: number; value: number }[] = []
    for (let e = 0; e < EVENTS; e++) {
      const tsMs = dayStartMs + (e + 1) * BINS_PER_EVENT * 60_000
      for (let b = 0; b < BINS_PER_EVENT; b++) samples.push({ tsMs, value: 1.2 + (b % 4) * 0.4 })
    }
    const grid = metGridFromDaytimeSamples(samples)
    return { grid, dayStartMs }
  }

  // The two OTS cases need the vendor's own tables: the synthetic fixtures are structurally
  // well-formed but semantically arbitrary (their age groups are [7,8,1,2,3,4,5,6]), so a score
  // computed from them says nothing. The upsert case below deliberately does NOT guard — whether
  // the column accepts a write is the half Q-270 doubted, and it needs no model at all.
  const itVendor = it.skipIf(!hasRealConstants())

  itVendor('the seeded day clears all four gates and yields an OTS', () => {
    const { grid, dayStartMs } = stressInputs()
    expect(grid.metsPerMinute.length, 'the MET gate needs 720 minutes of grid').toBeGreaterThanOrEqual(720)

    const result = computeTrainingStress({
      startTimestampMs: grid.metsPerMinute.length > 0 ? grid.startTimestampMs : dayStartMs,
      metsPerMinute: grid.metsPerMinute,
      age: 33, sex: 'male', rhr: 52,
      readiness: 74, readinessProvisional: false,
      vo2maxInputs: { restingHr: 52, measuredMaxHr: null, age: 33, sex: 'male', weightKg: 72, heightCm: 175, activityLevel: 'moderate' },
      tzChange: 0,
    })

    // Named rather than asserted as a bare truthy: a gated result carries the reason, and printing
    // it is what tells the next reader which gate moved rather than that "it broke".
    expect(result.status === 'ok' ? 'ok' : `gated:${result.reason}`).toBe('ok')
  })

  itVendor('and the upsert actually lands it in the column', async () => {
    const { grid, dayStartMs } = stressInputs()
    const result = computeTrainingStress({
      startTimestampMs: grid.startTimestampMs || dayStartMs,
      metsPerMinute: grid.metsPerMinute,
      age: 33, sex: 'male', rhr: 52,
      readiness: 74, readinessProvisional: false,
      vo2maxInputs: { restingHr: 52, measuredMaxHr: null, age: 33, sex: 'male', weightKg: 72, heightCm: 175, activityLevel: 'moderate' },
      tzChange: 0,
    })
    if (result.status !== 'ok') throw new Error(`fixture gated: ${result.reason}`)

    const { upsertOuraDailyDerived } = await import('@/lib/data/postgres/slices/oura')
    await upsertOuraDailyDerived(db, TEST_USER_ID, DAY, {
      trainingLoadOts: result.ots,
      trainingLoadHigh: result.high,
    })

    const { rows } = await pool.query<{ ots: string | null; high: boolean | null }>(
      `SELECT training_load_ots AS ots, training_load_high AS high
         FROM oura_daily_derived WHERE user_id = $1 AND day = $2::date`,
      [TEST_USER_ID, DAY],
    )
    expect(rows, 'the upsert must create the row, not silently no-op').toHaveLength(1)
    expect(Number(rows[0].ots), 'training_load_ots is the column Q-270 is about').toBeGreaterThan(0)
    expect(rows[0].high).not.toBeNull()
  })

  /**
   * The COALESCE arm of the upsert keeps an existing value when the new one is null, which is right
   * for a partial recompute and would be wrong if it also swallowed a real number. Pinned because
   * "the write silently did nothing" is the shape Q-270 spent two sessions failing to rule out.
   */
  it('a later write updates the value rather than being coalesced away', async () => {
    const { upsertOuraDailyDerived } = await import('@/lib/data/postgres/slices/oura')
    await upsertOuraDailyDerived(db, TEST_USER_ID, DAY, { trainingLoadOts: 123.5, trainingLoadHigh: true })

    const { rows } = await pool.query<{ ots: string }>(
      `SELECT training_load_ots AS ots FROM oura_daily_derived WHERE user_id = $1 AND day = $2::date`,
      [TEST_USER_ID, DAY],
    )
    expect(Number(rows[0].ots)).toBeCloseTo(123.5, 5)
  })
})
