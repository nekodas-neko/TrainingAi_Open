// Regression: aggregateOuraRawSamples must not throw on a real overnight volume
// of IBI samples. The original code built `Math.min(...hr)` over every in-window
// HR sample; an 8-hour sleep drain holds tens of thousands of them, and the spread
// blew V8's argument-count limit (RangeError) — which, thrown after the raw rows
// were already stored, turned every ingest POST into a 500 and wedged the ring
// cursor (it re-drained + re-failed forever). This seeds that volume and asserts
// the rollup completes and produces a sleep row with a low HR.
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000bee5'

// 8 hours in deciseconds (10 ds = 1 s).
const START_DS = 40_000_000
const END_DS = START_DS + 8 * 3600 * 10
const ANCHOR_UTC = '2026-07-07T21:00:00.000Z'

describe.skipIf(!canRun)('aggregateOuraRawSamples — overnight IBI volume', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `ble-agg-${TEST_USER_ID}@example.com`],
    )
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])

    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, END_DS, ANCHOR_UTC],
    )

    // Bedtime window (0x76) defining the sleep session.
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded)
       VALUES ($1, $2, 118, 'bedtime_period', 'deadbeef', $3)`,
      [TEST_USER_ID, END_DS, JSON.stringify({ bedtime_start_ds: START_DS, bedtime_end_ds: END_DS })],
    )

    // 400 IBI rows (tag 0x80), each carrying 500 HR samples → 200,000 in-window
    // values: comfortably past the spread limit that crashed the old code.
    const perRow = 500
    const rowCount = 400
    const hr = Array.from({ length: perRow }, (_, i) => 45 + (i % 30))
    hr[0] = 41 // the value the min must find
    const decoded = JSON.stringify({ hr_bpm: hr })
    const values: string[] = []
    const params: unknown[] = []
    for (let r = 0; r < rowCount; r++) {
      const ds = START_DS + Math.floor((r / rowCount) * (END_DS - START_DS))
      const b = params.length
      values.push(`($1, $${b + 2}, 128, 'ibi_and_amplitude_event', 'aa', $${b + 3}::jsonb)`)
      params.push(ds, decoded)
    }
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${values.join(',')}`,
      [TEST_USER_ID, ...params],
    )

    // A few more event types so the summary's tiles / inspector / unknown-tag
    // surfacing have something to report: HRV (0x5d), SpO₂ (0x6f), undecoded (0x77),
    // plus in-window raw R/PI (0x8b) that the firmware % must take precedence over.
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES
         ($1, $2, 93, 'hrv_event', 'bb', $3::jsonb),
         ($1, $4, 111, 'spo2_event', 'cc', $5::jsonb),
         ($1, $6, 119, 'unknown', 'dd', NULL),
         ($1, $7, 139, 'spo2_r_pi_event', 'ee', $8::jsonb)`,
      [
        TEST_USER_ID,
        END_DS - 100, JSON.stringify({ hr_bpm: [50], rmssd_ms: [42], interval_min: 5 }),
        END_DS - 50, JSON.stringify({ spo2_percent: [97] }),
        END_DS - 10,
        END_DS - 60, JSON.stringify({ r: [0.9, 0.9], perfusion_index: [0.02, 0.02] }),
      ],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('rolls up without a spread RangeError and records the lowest HR', async () => {
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')
    expect(result.sleepSessions).toBeGreaterThanOrEqual(1)

    const { rows } = await pool.query(
      `SELECT lowest_heart_rate, avg_heart_rate FROM sleep_sessions WHERE user_id = $1 AND oura_id = $2`,
      [TEST_USER_ID, `ble:${START_DS}`],
    )
    expect(rows.length).toBe(1)
    // Resting HR is the lowest 5-min-binned average now (not the raw per-beat min of
    // 41) — with this seed's HR spread that lands well above the single low beat.
    expect(Number(rows[0].lowest_heart_rate)).toBeGreaterThan(41)
    expect(Number(rows[0].lowest_heart_rate)).toBeLessThan(75)
    expect(Number(rows[0].avg_heart_rate)).toBeGreaterThan(0)

    // Firmware % (0x6f) outranks the derived 0x8b estimate on the same day —
    // the in-window r=0.9 samples (≈89%) must not dilute the direct 97.
    const { rows: bm } = await pool.query(
      `SELECT spo2_pct FROM body_metrics WHERE user_id = $1 AND spo2_pct IS NOT NULL`,
      [TEST_USER_ID],
    )
    expect(bm.length).toBe(1)
    expect(Number(bm[0].spo2_pct)).toBe(97)
  })

  it('bins HR at 15s inside a workout window, 5min outside', async () => {
    // Workout covering the hour before the anchor (wall-clock ANCHOR_UTC).
    const workoutEnd = new Date(ANCHOR_UTC)
    const workoutStart = new Date(workoutEnd.getTime() - 3600_000)
    await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at) VALUES ($1, 'HR bin test', $2, $3)`,
      [TEST_USER_ID, workoutStart.toISOString(), workoutEnd.toISOString()],
    )
    const res = await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')
    // The seed's IBI rows arrive every ~72s; at 5-min bins the workout hour holds
    // ~12 points, at 15s bins each sample row lands in its own bin (~50).
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM oura_heartrate
       WHERE user_id = $1 AND source = 'ble' AND timestamp BETWEEN $2 AND $3`,
      [TEST_USER_ID, workoutStart.toISOString(), workoutEnd.toISOString()],
    )
    expect(rows[0].n).toBeGreaterThan(30)
    expect(res.hrSeriesPoints).toBeGreaterThan(100)
  })

  it('summary surfaces the new tiles, per-tag inspector rows, and undecoded tags', async () => {
    const summary = await repo.getOuraRawSampleSummary(TEST_USER_ID)

    expect(summary.latestHrvRmssd).toBe(42)
    expect(summary.latestSpo2).toEqual({ pct: 97, calibrated: true })

    // byEventName carries the tag so undecoded tags stay distinct.
    //
    // Q-541 Task 3: the name is now derived from `eventName(tag)` rather than read from the stored
    // `event_name` column, because a packed frame does not carry one — and grouping on a column one
    // tier lacks would split a single tag into two rows. The fixture deliberately stores the STALE
    // 'unknown' for 0x77, so this also pins the consequence: a stored name that has drifted from
    // the decoder no longer reaches the summary. That drift is real — `refreshRawSampleEventNames`
    // exists to repair it — and deriving is what makes the repair unnecessary.
    const undecoded = summary.byEventName.find((b) => b.tag === 0x77)
    expect(undecoded?.eventName).toBe('spo2_dc_event')

    // Inspector: one newest row per event type, including the undecoded one (decoded null).
    const tags = new Set(summary.latestByTag.map((r) => r.tag))
    expect(tags.has(0x5d)).toBe(true)
    expect(tags.has(0x77)).toBe(true)
    expect(summary.latestByTag.find((r) => r.tag === 0x77)?.decoded).toBeNull()
  })
})
