// The Ring 5 emits no bedtime_period (0x76) events, so the rollup must derive the
// sleep window from the ring's sleep-only signals (sleep_acm_period 0x72 / sleep_temp
// 0x75). This seeds a night with NO 0x76 — only 0x72 sleep signals + HR (0x60) + HRV
// (0x5d) — and asserts a sleep session and a body_metrics row (HRV + resting HR) land.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000f00b'
const ANCHOR_DS = 70_000_000
const START_DS = ANCHOR_DS - 8 * 3600 * 10 // 8h before the anchor
const ANCHOR_UTC = '2026-07-08T09:00:00.000Z'

describe.skipIf(!canRun)('aggregateOuraRawSamples — sleep window without bedtime events', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID, `sleep-fallback-${TEST_USER_ID}@example.com`])
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_daily WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, ANCHOR_DS, ANCHOR_UTC])

    const rows: string[] = []
    const params: unknown[] = [TEST_USER_ID]
    const push = (ds: number, tag: number, name: string, decoded: object) => {
      const b = params.length
      rows.push(`($1, $${b + 1}, $${b + 2}, $${b + 3}, 'aa', $${b + 4}::jsonb)`)
      params.push(ds, tag, name, JSON.stringify(decoded))
    }
    // sleep_acm_period (0x72) every ~5 min across the night — NO bedtime (0x76).
    for (let ds = START_DS; ds <= ANCHOR_DS; ds += 3000) push(ds, 0x72, 'sleep_acm_period', { acm_mad: [0.1, 0.2, 0.1] })
    // HR (0x60) every ~30s; real sleep HR ~46-52, with an occasional 30-bpm artifact
    // (a lone 2000ms IBI) that the old raw-min would have grabbed as "resting HR".
    // The IBI stream carries a synthetic respiratory sinus arrhythmia (RSA) — an
    // ~800ms baseline beat interval modulated by a ~4.2s breathing cycle (~14
    // breaths/min) — so breathingFromIbi (Task 2.1) has a real oscillation to detect,
    // not just a handful of near-constant values per event.
    const BASE_IBI_MS = 800
    const AMP_IBI_MS = 60
    const BREATH_PERIOD_MS = 4200
    const totalMs = ((ANCHOR_DS - START_DS) / 10) * 1000
    const ibiBeats: { t: number; ibi: number }[] = []
    for (let t = 0; t < totalMs; ) {
      const ibi = Math.round(BASE_IBI_MS + AMP_IBI_MS * Math.sin((2 * Math.PI * t) / BREATH_PERIOD_MS))
      ibiBeats.push({ t, ibi })
      t += ibi
    }
    let i = 0
    for (let ds = START_DS; ds <= ANCHOR_DS; ds += 300, i++) {
      const hr = i % 15 === 0 ? [30, 50, 51] : [46 + (ds % 7), 52, 50]
      const eventStartMs = ((ds - START_DS) / 10) * 1000
      const eventEndMs = eventStartMs + 30000
      const ibiChunk = ibiBeats.filter((b) => b.t >= eventStartMs && b.t < eventEndMs).map((b) => b.ibi)
      push(ds, 0x60, 'ibi_and_amplitude_event', { hr_bpm: hr, ibi_ms: ibiChunk, amplitude: [1, 1, 1] })
    }
    // HRV (0x5d) every ~5 min, rmssd ~42.
    for (let ds = START_DS; ds <= ANCHOR_DS; ds += 3000) push(ds, 0x5d, 'hrv_event', { hr_bpm: [50], rmssd_ms: [42], interval_min: 5 })
    // SpO₂ raw R/PI (0x8b) — the only SpO₂ event the Ring 5 emits. r 0.78/0.80 →
    // 93.06944/92.544 under the gen4 quadratic; nightly mean 92.8.
    for (let ds = START_DS; ds <= ANCHOR_DS; ds += 3000)
      push(ds, 0x8b, 'spo2_r_pi_event', { r: [0.78, 0.8], perfusion_index: [0.02, 0.02] })
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${rows.join(',')}`,
      params)
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_daily WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('derives a sleep session + HRV/resting-HR from sleep signals alone', async () => {
    const res = await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')
    expect(res.sleepSessions).toBeGreaterThanOrEqual(1)
    expect(res.bodyMetricDays).toBeGreaterThanOrEqual(1)

    const { rows: bm } = await pool.query(
      `SELECT hrv_ms, resting_heart_rate, spo2_pct FROM body_metrics WHERE user_id = $1 AND hrv_ms IS NOT NULL`,
      [TEST_USER_ID])
    expect(bm.length).toBeGreaterThanOrEqual(1)
    expect(Number(bm[0].hrv_ms)).toBe(42)
    // Resting HR must reject the 30-bpm artifact (raw-min would have returned 30).
    expect(Number(bm[0].resting_heart_rate)).toBeGreaterThan(40)
    expect(Number(bm[0].resting_heart_rate)).toBeLessThan(60)
    // SpO₂ derived from raw 0x8b R via the gen4 quadratic, keyed to the wake day.
    expect(Number(bm[0].spo2_pct)).toBeCloseTo(92.8, 1)

    // Respiratory rate: night median of per-epoch breathingFromIbi rates, derived
    // from the same raw IBI stream (Task 2.1) — plausibility band 8-22 br/min.
    const { rows: sleep } = await pool.query(
      `SELECT respiratory_rate FROM sleep_sessions WHERE user_id = $1`,
      [TEST_USER_ID])
    expect(sleep.length).toBeGreaterThanOrEqual(1)
    expect(Number(sleep[0].respiratory_rate)).toBeGreaterThanOrEqual(8)
    expect(Number(sleep[0].respiratory_rate)).toBeLessThanOrEqual(22)
  })

  it('summary estimates SpO₂ from R/PI when no firmware % exists', async () => {
    const summary = await repo.getOuraRawSampleSummary(TEST_USER_ID)
    expect(summary.latestSpo2).toEqual({ pct: 93, calibrated: false })
  })

  it('materializes a binned HR series and a derived wear-time day', async () => {
    const res = await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')
    // 8h of 0x60 samples → ~96 five-minute bins; the 30-bpm artifacts fall
    // below the series band filter, so every bin averages in the 40s-50s.
    expect(res.hrSeriesPoints).toBeGreaterThanOrEqual(90)
    const { rows: hr } = await pool.query(
      `SELECT min(bpm) AS lo, max(bpm) AS hi, count(*)::int AS n FROM oura_heartrate WHERE user_id = $1 AND source = 'ble'`,
      [TEST_USER_ID])
    expect(hr[0].n).toBe(res.hrSeriesPoints)
    expect(Number(hr[0].lo)).toBeGreaterThan(40)
    expect(Number(hr[0].hi)).toBeLessThan(60)

    // Wear time: the night's signals mark ~8h of 15-min bins worn, so non-wear
    // stays well under a full day (today-partial semantics cap it at elapsed time).
    expect(res.wearDays).toBeGreaterThanOrEqual(1)
    const { rows: wear } = await pool.query(
      `SELECT non_wear_time_sec FROM oura_daily WHERE user_id = $1 AND non_wear_time_sec IS NOT NULL`,
      [TEST_USER_ID])
    expect(wear.length).toBeGreaterThanOrEqual(1)
    expect(Number(wear[0].non_wear_time_sec)).toBeLessThanOrEqual(86400 - 8 * 3600)
  })

  // Runs LAST. This used to assert the redecode re-STAMPED `measured_at` onto the row. It no longer
  // writes anything (Q-541 Task 7 — every reader derives the time from the anchors, so the column is
  // dead, and the re-stamp is what filled the disk on 2026-08-17). What is asserted now is the same
  // arithmetic on the reading side: the anchor pairs ANCHOR_DS ↔ ANCHOR_UTC, so a frame one ring-hour
  // earlier must READ as exactly one hour before ANCHOR_UTC, whatever the stored column says.
  it('derives measured_at from the current anchor, without writing it', async () => {
    const before = (await pool.query(
      `SELECT measured_at FROM oura_raw_samples WHERE user_id = $1 AND ring_timestamp_ds = $2 AND tag = 114`,
      [TEST_USER_ID, ANCHOR_DS - 36000])).rows
    await repo.redecodeOuraRawSamples(TEST_USER_ID)
    const after = (await pool.query(
      `SELECT measured_at FROM oura_raw_samples WHERE user_id = $1 AND ring_timestamp_ds = $2 AND tag = 114`,
      [TEST_USER_ID, ANCHOR_DS - 36000])).rows
    expect(after).toEqual(before)   // the pass wrote nothing

    const read = await repo.getOuraRawSamplesByTags(TEST_USER_ID, [114], 500)
    const row = read.find(r => r.ringTimestampDs === ANCHOR_DS - 36000)
    expect(row).toBeDefined()
    expect(new Date(row!.measuredAt!).getTime()).toBe(new Date(ANCHOR_UTC).getTime() - 3600_000)
  })
})
