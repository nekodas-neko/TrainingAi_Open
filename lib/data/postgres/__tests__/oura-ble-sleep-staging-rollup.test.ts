// The rollup must stage a night ITSELF (our heuristic stager) when the ring emits no phase
// events — the normal case on this Ring 5. Seeds a full night of movement (0x72) + HR (IBI) +
// HRV (0x5d) + temp (0x75) with a clear deep block and a wake block, and asserts the sleep row
// comes back with a populated sleep_phase_5_min hypnogram string, non-null stage hours, an
// efficiency, and onset latency — i.e. the black box is filled without ring stages.
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000d17a'

const H = 3600 * 10
const EPOCH_DS = 5 * 60 * 10
const START_DS = 6_000_000, END_DS = START_DS + 8 * H // exactly 96 five-min epochs
const ANCHOR_UTC = '2026-07-09T07:00:00.000Z'

describe.skipIf(!canRun)('aggregateOuraRawSamples — own heuristic staging (no ring phases)', () => {
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
      [TEST_USER_ID, `ble-stage-${TEST_USER_ID}@example.com`],
    )
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, END_DS, ANCHOR_UTC],
    )

    const rows: string[] = []
    const params: unknown[] = []
    const add = (ds: number, tag: number, name: string, decoded: unknown) => {
      const b = params.length
      rows.push(`($1, $${b + 2}, $${b + 3}, $${b + 4}, 'aa', $${b + 5}::jsonb)`)
      params.push(ds, tag, name, JSON.stringify(decoded))
    }
    for (let k = 0; k < 96; k++) {
      const ds = START_DS + k * EPOCH_DS
      const isWake = k >= 40 && k < 44           // a 20-min awakening (high movement)
      const isDeep = k >= 4 && k < 20            // deep block: low HR, high HRV
      const movement = isWake ? 40 : 0.1
      const hr = isWake ? 72 : isDeep ? 48 : 58
      const hrv = isDeep ? 62 : 34
      add(ds, 0x72, 'sleep_acm_period', { acm_mad: [movement, movement, movement, movement, movement, movement] })
      add(ds, 0x80, 'ibi_and_amplitude_event', { hr_bpm: [hr, hr, hr, hr] })
      add(ds, 0x5d, 'hrv_event', { hr_bpm: [hr], rmssd_ms: [hrv], interval_min: 5 })
      add(ds, 0x75, 'sleep_temp_event', { temps_c: [35] })
    }
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${rows.join(',')}`,
      [TEST_USER_ID, ...params],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('produces a hypnogram + stage hours + efficiency from our own model', async () => {
    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')
    const { rows } = await pool.query(
      `SELECT sleep_phase_5_min, deep_sleep_hours, rem_sleep_hours, light_sleep_hours,
              awake_hours, efficiency, onset_latency_sec, duration_hours
         FROM sleep_sessions WHERE user_id = $1 AND oura_id = $2`,
      [TEST_USER_ID, `ble:${START_DS}`],
    )
    expect(rows.length).toBe(1)
    const r = rows[0]
    // One char per 5-min epoch across the sleep-signal window (~8h → ~95 epochs).
    expect(r.sleep_phase_5_min.length).toBeGreaterThan(80)
    // Stages actually classified (not all null) — deep block + wake block detected.
    expect(Number(r.deep_sleep_hours)).toBeGreaterThan(0)
    expect(r.sleep_phase_5_min).toContain('1') // deep
    expect(r.sleep_phase_5_min).toContain('4') // the awakening
    // Derived metrics present and sane.
    expect(Number(r.efficiency)).toBeGreaterThan(50)
    expect(Number(r.efficiency)).toBeLessThanOrEqual(100)
    expect(Number(r.onset_latency_sec)).toBeGreaterThanOrEqual(0)
    expect(Number(r.duration_hours)).toBeGreaterThan(6)
  })

  it('returns a per-epoch diagnostic for the requested debugDate', async () => {
    // The window ends at ANCHOR_UTC (2026-07-09T07:00Z) → 2026-07-09 local (Brisbane +10).
    const res = await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane', { debugDate: '2026-07-09' })
    const dbg = res.debugNight
    expect(dbg).not.toBeNull()
    expect(dbg!.date).toBe('2026-07-09')
    expect(dbg!.epochs.length).toBeGreaterThan(80)
    expect(typeof dbg!.settleHr === 'number' || dbg!.settleHr === null).toBe(true)
    // Deep block (k 4..19) has HR 48 and plenty of beats binned; a mid-deep epoch reflects that.
    const deep = dbg!.epochs[10]
    expect(deep.hr).toBeGreaterThan(40)
    expect(deep.beats).toBeGreaterThan(0)
    expect(['deep', 'light', 'rem', 'awake']).toContain(deep.stage)
    // The LF/HF term threads through the epoch builder end-to-end (number when beat-dense, else null).
    expect('lfhf' in deep).toBe(true)
    expect(deep.lfhf === null || typeof deep.lfhf === 'number').toBe(true)
    // A different date yields no diagnostic.
    const none = await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane', { debugDate: '2000-01-01' })
    expect(none.debugNight).toBeNull()
  })

  it('dumpOnly still returns a recent night without reprocessing full history', async () => {
    // The lightweight dump path (route ?dump=1) keeps the 35-day bound instead of forcing fullHistory,
    // so it must not time out — but a RECENT night (this test's window sits at the anchor) is well
    // within the window and its diagnostic must still come back.
    const res = await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane', { debugDate: '2026-07-09', dumpOnly: true })
    expect(res.debugNight).not.toBeNull()
    expect(res.debugNight!.date).toBe('2026-07-09')
    expect(res.debugNight!.epochs.length).toBeGreaterThan(80)
  })
})

// When two windows share a wake-day — the real overnight plus a short evening rest fragment — the
// per-epoch diagnostic must show the MAIN night, not whichever window was processed last. (Prod
// 07-10: the debug dump surfaced a 17:33–19:24 evening fragment instead of the 9h overnight.)
describe.skipIf(!canRun)('aggregateOuraRawSamples — debug picks the longest window on a shared wake-day', () => {
  const USER = '00000000-0000-4000-8000-00000000d17b'
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
      [USER, `ble-frag-${USER}@example.com`],
    )
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [USER, END_DS, ANCHOR_UTC],
    )

    const rows: string[] = []
    const params: unknown[] = []
    const add = (ds: number, tag: number, name: string, decoded: unknown) => {
      const b = params.length
      rows.push(`($1, $${b + 2}, $${b + 3}, $${b + 4}, 'aa', $${b + 5}::jsonb)`)
      params.push(ds, tag, name, JSON.stringify(decoded))
    }
    const seedEpoch = (ds: number) => {
      add(ds, 0x72, 'sleep_acm_period', { acm_mad: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1] })
      add(ds, 0x80, 'ibi_and_amplitude_event', { hr_bpm: [55, 55, 55, 55] })
      add(ds, 0x5d, 'hrv_event', { hr_bpm: [55], rmssd_ms: [45], interval_min: 5 })
      add(ds, 0x75, 'sleep_temp_event', { temps_c: [35] })
    }
    // Main overnight: 96 five-min epochs ending at the anchor (wake-day 2026-07-09).
    for (let k = 0; k < 96; k++) seedEpoch(START_DS + k * EPOCH_DS)
    // Evening rest fragment: starts exactly 3h after the main night ends (a >2h gap splits the
    // cluster, a ≥3h gap escapes the merge), 18 epochs (~1.5h), still ending on 2026-07-09 local.
    const FRAG_START = END_DS + 3 * H
    for (let k = 0; k < 18; k++) seedEpoch(FRAG_START + k * EPOCH_DS)
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${rows.join(',')}`,
      [USER, ...params],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('surfaces the ~8h overnight, not the ~1.5h evening fragment', async () => {
    const res = await repo.aggregateOuraRawSamples(USER, 'Australia/Brisbane', { debugDate: '2026-07-09' })
    // Both windows share the 2026-07-09 wake-day → two rows written, so the debug had to choose.
    const { rows } = await pool.query(
      `SELECT sleep_start FROM sleep_sessions WHERE user_id = $1 AND date = '2026-07-09'
         AND oura_id LIKE 'ble:%' ORDER BY sleep_start`,
      [USER],
    )
    expect(rows.length).toBe(2)
    const dbg = res.debugNight
    expect(dbg).not.toBeNull()
    // The fragment is only ~18 epochs; the overnight is ~96. Picking the longest window is the fix.
    expect(dbg!.epochs.length).toBeGreaterThan(80)
  })
})

// Regression for the 2026-07-14/15 "bedtime shown ~2h too early" reports. The night window can lead
// real sleep by hours: the ring spot-checks HR (a few beats/epoch) and can fire a short dense-but-awake
// burst during evening wind-down, but only streams DENSE continuous HR while asleep. The window must be
// clamped to the LONGEST dense HR run so neither the sparse evening NOR an early burst counts as sleep.
describe.skipIf(!canRun)('aggregateOuraRawSamples — clamps the window to the dense sleep run', () => {
  const USER = '00000000-0000-4000-8000-00000000d17c'
  const BURST_EPOCHS = 3       // early dense-but-awake burst (07-15: 19:53–20:03, HR ~73, moving)
  const PRESLEEP_EPOCHS = 24   // total pre-sleep (burst + sparse evening) before real sleep at epoch 24
  const denseHr = (bpm: number) => ({ hr_bpm: Array(40).fill(bpm) }) // dense epoch: 40 beats
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
      [USER, `ble-clamp-${USER}@example.com`],
    )
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [USER, END_DS, ANCHOR_UTC],
    )

    const rows: string[] = []
    const params: unknown[] = []
    const add = (ds: number, tag: number, name: string, decoded: unknown) => {
      const b = params.length
      rows.push(`($1, $${b + 2}, $${b + 3}, $${b + 4}, 'aa', $${b + 5}::jsonb)`)
      params.push(ds, tag, name, JSON.stringify(decoded))
    }
    // Early dense-but-awake burst (epochs 0–2): dense HR + movement, elevated HR — the 07-15 blip
    // that defeated the previous accelerometer-based clamp.
    for (let k = 0; k < BURST_EPOCHS; k++) {
      const ds = START_DS + k * EPOCH_DS
      add(ds, 0x72, 'sleep_acm_period', { acm_mad: [1.5, 1.5, 1.5, 1.5, 1.5, 1.5] })
      add(ds, 0x80, 'ibi_and_amplitude_event', denseHr(73))
      add(ds, 0x75, 'sleep_temp_event', { temps_c: [35] })
    }
    // Sparse evening spot-readings (epochs 3–23): a single beat, no accelerometer.
    for (let k = BURST_EPOCHS; k < PRESLEEP_EPOCHS; k++) {
      const ds = START_DS + k * EPOCH_DS
      add(ds, 0x75, 'sleep_temp_event', { temps_c: [35] })
      add(ds, 0x80, 'ibi_and_amplitude_event', { hr_bpm: [70] })
    }
    // Real sleep (epochs 24–95): dense continuous HR + accelerometer + hrv + temp.
    for (let k = PRESLEEP_EPOCHS; k < 96; k++) {
      const ds = START_DS + k * EPOCH_DS
      add(ds, 0x72, 'sleep_acm_period', { acm_mad: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1] })
      add(ds, 0x80, 'ibi_and_amplitude_event', denseHr(55))
      add(ds, 0x5d, 'hrv_event', { hr_bpm: [55], rmssd_ms: [45], interval_min: 5 })
      add(ds, 0x75, 'sleep_temp_event', { temps_c: [35] })
    }
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${rows.join(',')}`,
      [USER, ...params],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('starts the night at the dense sleep run, past both the early burst and the sparse evening', async () => {
    await repo.aggregateOuraRawSamples(USER, 'Australia/Brisbane')
    const { rows } = await pool.query(
      `SELECT sleep_start, sleep_end, sleep_phase_5_min, duration_hours
         FROM sleep_sessions WHERE user_id = $1 AND oura_id LIKE 'ble:%'`,
      [USER],
    )
    expect(rows.length).toBe(1)
    const r = rows[0]
    // The raw window starts 8h before the anchor (2026-07-08T23:00Z, the early burst); dense sleep
    // starts 2h later at 2026-07-09T01:00Z. The written bedtime must be 01:00Z, not 23:00Z.
    expect(new Date(r.sleep_start).toISOString()).toBe('2026-07-09T01:00:00.000Z')
    // End = the last sample (06:55Z); there's no sample at the 07:00Z anchor itself.
    expect(new Date(r.sleep_end).toISOString()).toBe('2026-07-09T06:55:00.000Z')
    // ~72 epochs (6h), not ~96 (8h) — the burst + sparse evening were excluded from the night.
    expect(r.sleep_phase_5_min.length).toBeGreaterThan(68)
    expect(r.sleep_phase_5_min.length).toBeLessThan(76)
  })
})
