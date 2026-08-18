// getOuraRawSamplesForTags decodes from body_hex (2026-08-05, Q-81).
//
// It used to filter on `decoded IS NOT NULL` and return the stored column. That column has never
// been written — 0 of 812,816 production rows across all 30 tags — because body_hex is the archival
// source of truth and every other consumer decodes it on the fly. So this function returned an
// empty array for every caller, forever: the daytime-HRV model never fitted, and
// /api/oura-ble/device-metrics answered {"days": []} on a device that had been ingesting all day.
//
// The frames below are real, pulled from production on 2026-08-05.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { extractNightlyTrainingSamples, fitDaytimeHrvModel } from '@trainingai/shared/health/daytime-hrv-model'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000de01'

/** hrv_event: 5 pairs of (avg HR, avg rMSSD) per frame, one pair per 5 minutes. */
const HRV_HEX = '3e223d313c3c3a3f3c49'
/** temp_event: 3 skin temps each. Three distinct real frames, cycled — a single repeated frame
 *  gives temp zero variance, which makes the model's 3x3 system singular and a null fit CORRECT.
 *  Real variance is what proves the fit actually runs. */
const TEMP_HEXES = ['8309c409870a', 'c509280aba0a', '080c800cd00c']

describe.skipIf(!canRun)('getOuraRawSamplesForTags decodes body_hex', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const sleepStart = new Date(Date.now() - 8 * 3600_000)
  const sleepEnd = new Date(Date.now() - 1 * 3600_000)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `rawdecode-${TEST_USER_ID}@example.com`],
    )
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [TEST_USER_ID])

    // A clock anchor, because `getOuraRawSamplesForTags` now derives wall-clock time from the
    // anchors rather than reading the stored `measured_at` column (Q-541 Task 7 / Q-534, which drops
    // the index that column had). This fixture used to stamp `measured_at` by hand and supply no
    // anchor at all — a state production cannot be in, since anchors are append-only and every
    // stamped row was stamped FROM one. Supplying it is what makes the fixture model production.
    //
    // The ds values are now consistent with the wall-clock times too: 5 minutes is 3,000
    // deciseconds. Before, ds advanced 0.2 s per frame while `measured_at` advanced 5 minutes, so
    // the two columns described different histories — invisible while nothing derived one from the
    // other.
    const ANCHOR_DS = 1_000_000
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc, epoch, observed_source)
       VALUES ($1, $2, $3, 0, 'test')`,
      [TEST_USER_ID, ANCHOR_DS, sleepStart],
    )

    // 30 hrv frames + 30 temp frames spread across the sleep window. `decoded` deliberately left
    // NULL — that is exactly the production shape this regression is about.
    for (let i = 0; i < 30; i++) {
      const at = new Date(sleepStart.getTime() + i * 5 * 60_000)
      await pool.query(
        `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, measured_at)
         VALUES ($1,$2,93,'hrv_event',$3,$4), ($1,$5,70,'temp_event',$6,$4)
         ON CONFLICT DO NOTHING`,
        [TEST_USER_ID, ANCHOR_DS + i * 3_000, HRV_HEX, at, ANCHOR_DS + i * 3_000 + 1, TEMP_HEXES[i % TEMP_HEXES.length]],
      )
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('returns rows whose decoded payload came from body_hex, not the stored column', async () => {
    const rows = await repo.getOuraRawSamplesForTags(TEST_USER_ID, [0x5d, 0x46, 0x69], 7)
    expect(rows.length).toBe(60)
    const hrv = rows.find(r => r.tag === 0x5d)!
    // The three keys the daytime-HRV model reads. Before the fix this whole array was empty.
    expect(hrv.decoded).toMatchObject({ hr_bpm: expect.any(Array), rmssd_ms: expect.any(Array) })
    const temp = rows.find(r => r.tag === 0x46)!
    expect(temp.decoded).toMatchObject({ temps_c: expect.any(Array) })
  })

  it('yields training samples and a fitted model — the whole chain Q-81 broke', async () => {
    const rows = await repo.getOuraRawSamplesForTags(TEST_USER_ID, [0x5d, 0x46, 0x69], 7)
    const samples = extractNightlyTrainingSamples(rows, [{ sleepStart, sleepEnd }])
    // 30 frames × 5 (hr, rmssd) pairs each.
    expect(samples.length).toBe(150)
    const model = fitDaytimeHrvModel(samples)
    // The whole point: a real model, from raw hex, through the function that used to return nothing.
    expect(model).not.toBeNull()
    expect(model!.nSamples).toBe(150)
    expect(Number.isFinite(model!.intercept)).toBe(true)
    expect(Number.isFinite(model!.hrCoef)).toBe(true)
    expect(Number.isFinite(model!.residualStd)).toBe(true)
  })

  it('returns nothing for a tag with no rows, rather than throwing', async () => {
    expect(await repo.getOuraRawSamplesForTags(TEST_USER_ID, [0x01], 7)).toEqual([])
    expect(await repo.getOuraRawSamplesForTags(TEST_USER_ID, [], 7)).toEqual([])
  })
})
