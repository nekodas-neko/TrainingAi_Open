// Q-273 — `oura_daily_derived.model_versions` is a MAP of pillar → model version, and the shared
// upsert wrote it with `COALESCE(excluded, existing)`, which is replace-if-non-null. For a map that
// means the last pillar to stamp wins and every other pillar's key is silently gone.
//
// It was live, not theoretical: `backfillBodyComp` writes `{bodyComp: …}` flat, so every day it
// touched lost its readiness stamp. Readiness escaped only because it read the row first and spread
// the result back — two statements, so a race, against a value that may already be stale.
//
// The stamp exists so a correlation computed across a model change can be split by model. A stamp
// that another pillar can erase does not do that job, and the erasure leaves no trace.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000027e001'
const DAY = '2026-08-14'

describe.skipIf(!canRun)('oura_daily_derived.model_versions merges rather than replaces (Q-273)', () => {
  let pool: import('pg').Pool
  let db: Awaited<ReturnType<typeof import('@/lib/data/postgres/client').getDb>>
  let oura: typeof import('@/lib/data/postgres/slices/oura')

  beforeAll(async () => {
    const { getPool, getDb } = await import('@/lib/data/postgres/client')
    oura = await import('@/lib/data/postgres/slices/oura')
    pool = getPool(); db = await getDb()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, `model-versions-merge-${USER}@example.com`])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [USER])
  })

  const versions = async () => {
    const { rows } = await pool.query(
      `SELECT model_versions FROM oura_daily_derived WHERE user_id = $1 AND day = $2`, [USER, DAY])
    return rows[0]?.model_versions ?? null
  }

  // The exact live sequence: readiness stamps on app open, then the body-comp backfill runs.
  it('a later pillar stamping its own key keeps the earlier one', async () => {
    await oura.upsertOuraDailyDerived(db, USER, DAY, {
      readinessScore: 71, modelVersions: { readiness: 'v3:ri5:2026-08-18' },
    })
    await oura.upsertOuraDailyDerived(db, USER, DAY, {
      bodyComp: { fatMassKg: 18 }, modelVersions: { bodyComp: 'atlas_2_1_0' },
    })
    expect(await versions()).toEqual({ readiness: 'v3:ri5:2026-08-18', bodyComp: 'atlas_2_1_0' })
  })

  it('holds in the other order too', async () => {
    await oura.upsertOuraDailyDerived(db, USER, DAY, {
      bodyComp: { fatMassKg: 18 }, modelVersions: { bodyComp: 'atlas_2_1_0' },
    })
    await oura.upsertOuraDailyDerived(db, USER, DAY, {
      readinessScore: 71, modelVersions: { readiness: 'v3:ri5:2026-08-18' },
    })
    expect(await versions()).toEqual({ readiness: 'v3:ri5:2026-08-18', bodyComp: 'atlas_2_1_0' })
  })

  // A model version must still be able to CHANGE — merging must not freeze the first value written.
  it('re-stamping the same pillar overwrites that key only', async () => {
    await oura.upsertOuraDailyDerived(db, USER, DAY, {
      modelVersions: { readiness: 'v2:old', bodyComp: 'atlas_2_1_0' },
    })
    await oura.upsertOuraDailyDerived(db, USER, DAY, {
      modelVersions: { readiness: 'v3:ri5:2026-08-18' },
    })
    expect(await versions()).toEqual({ readiness: 'v3:ri5:2026-08-18', bodyComp: 'atlas_2_1_0' })
  })

  // Most writers (illness, BDI, resilience, chronic stress) never pass the field at all. They must
  // leave it exactly as it was — this is what the COALESCE upsert already guaranteed and what the
  // change must not break.
  it('a write that omits the field does not touch it', async () => {
    await oura.upsertOuraDailyDerived(db, USER, DAY, {
      modelVersions: { readiness: 'v3:ri5:2026-08-18' },
    })
    await oura.upsertOuraDailyDerived(db, USER, DAY, { illnessFlag: true, illnessScore: 40 })
    expect(await versions()).toEqual({ readiness: 'v3:ri5:2026-08-18' })
  })

  it('the first stamp on a fresh row still lands', async () => {
    await oura.upsertOuraDailyDerived(db, USER, DAY, {
      modelVersions: { readiness: 'v3:ri5:2026-08-18' },
    })
    expect(await versions()).toEqual({ readiness: 'v3:ri5:2026-08-18' })
  })
})
