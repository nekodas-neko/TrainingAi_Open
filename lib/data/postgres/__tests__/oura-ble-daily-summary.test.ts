// End-to-end: the rollup's daily_summary step (Oura BLE Phase 5 addendum A3) turns
// raw sleep temperature (0x75) + MET (0x50) samples, plus the sleep window it already
// derives, into an oura_daily_summary row with a populated personal baseline.
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000da15'

const NIGHT1_START = 20_000_000
const NIGHT1_END = NIGHT1_START + 8 * 3600 * 10
const NIGHT2_START = NIGHT1_END + 16 * 3600 * 10 // next night, ~24h later
const NIGHT2_END = NIGHT2_START + 8 * 3600 * 10
const ANCHOR_UTC = '2026-07-11T21:00:00.000Z'

describe.skipIf(!canRun)('aggregateOuraRawSamples — daily summary + baselines', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  // tempC is real Celsius (e.g. 34.5), matching decodeTemperatures' `temps_c`
  // output convention — the adapter itself converts to centi-degC ints before
  // calling the ported nightlyTemperatureCentiC algorithm.
  async function seedNight(startDs: number, endDs: number, tempC: number) {
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded)
       VALUES ($1, $2, 118, 'bedtime_period', 'deadbeef', $3)`,
      [TEST_USER_ID, endDs, JSON.stringify({ bedtime_start_ds: startDs, bedtime_end_ds: endDs })],
    )
    // 400 IBI rows (tag 0x80 = 128) spread across the window so HRV/RHR/recovery
    // all have signal.
    const rowCount = 400
    const hr = Array.from({ length: 20 }, (_, i) => 48 + (i % 10))
    // A real respiratory-sinus-arrhythmia beat train so breathingFromIbi has a rate to find:
    // ~800 ms beats modulated by a 4.2 s breathing cycle ≈ 14.3 br/min (same shape as
    // oura-ble-sleep-fallback.test.ts). Sliced per-row into ibi_ms below.
    const BASE_IBI_MS = 800, AMP_IBI_MS = 60, BREATH_PERIOD_MS = 4200
    const totalMs = ((endDs - startDs) / 10) * 1000
    const beats: { t: number; ibi: number }[] = []
    for (let t = 0; t < totalMs; ) {
      const ibi = Math.round(BASE_IBI_MS + AMP_IBI_MS * Math.sin((2 * Math.PI * t) / BREATH_PERIOD_MS))
      beats.push({ t, ibi })
      t += ibi
    }
    const values: string[] = []
    const params: unknown[] = []
    for (let r = 0; r < rowCount; r++) {
      const ds = startDs + Math.floor((r / rowCount) * (endDs - startDs))
      const rowStartMs = (r / rowCount) * totalMs
      const rowEndMs = rowStartMs + totalMs / rowCount
      const ibiChunk = beats.filter(b => b.t >= rowStartMs && b.t < rowEndMs).map(b => b.ibi)
      const decoded = JSON.stringify({ hr_bpm: hr, rmssd_ms: [42, 44, 46], ibi_ms: ibiChunk })
      const b = params.length
      values.push(`($1, $${b + 2}, 128, 'ibi_and_amplitude_event', 'aa', $${b + 3}::jsonb)`)
      params.push(ds, decoded)
    }
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${values.join(',')}`,
      [TEST_USER_ID, ...params],
    )
    // 150 steady temperature samples (tag 0x75 = 117, sleep_temp) -> 5 windows all at
    // tempC, matching the ported algorithm's own pinned "constant_night" test shape.
    //
    // Each night ALSO gets 0x46 (= 70) rows at a deliberately wrong temperature. The
    // rollup consumes 0x75 alone — 0x46's middle value sits on a 0.5 degC grid and
    // quantises the nightly result — so these must not influence the assertions below.
    // If the two streams are ever re-merged, tempMeanC moves off tempC and this fails,
    // which is the point: the exclusion is load-bearing, not incidental.
    const DECOY_OFFSET_C = 5
    const tempValues: string[] = []
    const tempParams: unknown[] = []
    for (let i = 0; i < 150; i++) {
      const ds = startDs + Math.floor((i / 150) * (endDs - startDs))
      const b = tempParams.length
      tempValues.push(`($1, $${b + 2}, 117, 'sleep_temp_event', 'ff', $${b + 3}::jsonb)`)
      tempParams.push(ds, JSON.stringify({ temps_c: [tempC] }))
    }
    for (let i = 0; i < 150; i++) {
      const ds = startDs + Math.floor((i / 150) * (endDs - startDs))
      const b = tempParams.length
      tempValues.push(`($1, $${b + 2}, 70, 'temp_event', 'ff', $${b + 3}::jsonb)`)
      tempParams.push(ds, JSON.stringify({ temps_c: [tempC + DECOY_OFFSET_C] }))
    }
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${tempValues.join(',')}`,
      [TEST_USER_ID, ...tempParams],
    )
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `ble-daily-summary-${TEST_USER_ID}@example.com`],
    )
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_daily_summary WHERE user_id = $1`, [TEST_USER_ID])

    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, NIGHT2_END, ANCHOR_UTC],
    )

    await seedNight(NIGHT1_START, NIGHT1_END, 34.5)
    await seedNight(NIGHT2_START, NIGHT2_END, 35.5) // a 1.0 degC spike
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_daily_summary WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('writes one oura_daily_summary row per night with a real nightly temperature', async () => {
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')
    expect(result.sleepSessions).toBe(2)

    const rows = await repo.getOuraDailySummary(TEST_USER_ID, '2000-01-01', '2100-01-01')
    expect(rows.length).toBe(2)
    expect(rows[0].tempMeanC).toBeCloseTo(34.5, 1)
    expect(rows[1].tempMeanC).toBeCloseTo(35.5, 1)
  })

  it('accrues n_history sequentially and forms a temperature baseline by night 2', async () => {
    const rows = await repo.getOuraDailySummary(TEST_USER_ID, '2000-01-01', '2100-01-01')
    expect(rows[0].nHistory).toBe(1)
    expect(rows[1].nHistory).toBe(2)
    // First night: no prior baseline, so no deviation yet.
    expect(rows[0].tempDevC).toBeNull()
    // Q-6: night 2 previously reported a deviation here, and it was garbage — the ported baseline
    // starts from zero, so on the second night it sits at roughly half the real temperature and the
    // "deviation" reads around +17 degC. Both nights are now withheld until the baseline matures at
    // BASELINE_MIN_NIGHTS. The baseline state itself still folds every night.
    expect(rows[1].tempDevC).toBeNull()
    expect(rows[1].tempBaseline).not.toBeNull()
  })

  it('is idempotent — re-running the rollup produces the same two rows, not duplicates', async () => {
    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')
    const rows = await repo.getOuraDailySummary(TEST_USER_ID, '2000-01-01', '2100-01-01')
    expect(rows.length).toBe(2)
  })

  it('computes a nightly breathing rate and accrues its baseline (review S4)', async () => {
    const rows = await repo.getOuraDailySummary(TEST_USER_ID, '2000-01-01', '2100-01-01')
    // Night value in the plausibility band around the seeded ~14.3 br/min RSA.
    expect(rows[0].breathAvgRpm).not.toBeNull()
    expect(rows[0].breathAvgRpm!).toBeGreaterThanOrEqual(8)
    expect(rows[0].breathAvgRpm!).toBeLessThanOrEqual(22)
    // Baseline seeded by night 1, carried into night 2 (rpm×10 fixed-point state).
    expect(rows[1].breathBaseline).not.toBeNull()
  })
})
