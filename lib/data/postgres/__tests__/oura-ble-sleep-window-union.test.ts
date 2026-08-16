// Regression (found 2026-07-09): the rollup built sleep windows ONLY from bedtime_period
// (0x76) events whenever any existed, gating out the sleep-signal clustering fallback. The
// Ring 5's bedtime events are sparse and lag the night, so a just-finished night with none
// yet was silently dropped — its window-scoped HRV/resting-HR never landed (while the
// calendar-day SpO₂ and the window-independent HR series did, which is exactly what the
// owner saw: 07-09 had a full HR trace + SpO₂ but blank HRV/RHR and no sleep row).
// The fix: always cluster, and union clustered nights not already covered by a bedtime
// window. This seeds a bedtime-covered night 1 and a signals-only night 2 and asserts night 2
// still gets a sleep row WITH HRV + resting HR — and that night 1 isn't duplicated.
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// The models run from recordings of themselves, so this suite needs no `.onnx` file — see
// `lib/oura-models/inference/__tests__/helpers/replay-session.ts`. The rollup itself runs for real.
vi.mock('@/lib/oura-models/inference/session', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/oura-models/inference/session')>()
  const { makeReplayGetSession } = await import('@/lib/oura-models/inference/__tests__/helpers/replay-session')
  return { ...actual, getSession: makeReplayGetSession(actual.getSession) }
})


const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000c105'

const H = 3600 * 10 // 1 hour in deciseconds
// This ds base must stay unique ACROSS test files, not just within this one. The rollup derives
// oura_id as `ble:<startDs>` with no user component, while sleep_sessions.oura_id is globally
// unique — so two files sharing a base collide on that constraint even though they use different
// test users, and whichever loses has its sleep write rejected. Because aggregateOuraRawSamples
// swallows write errors into stepErrors, that surfaced only as an intermittent "expected 2, got 0"
// once the suite ran the two files concurrently. Bases are spaced 10M apart; see the sibling
// oura-ble-* rollup tests for the ones already taken.
const N1_START = 10_000_000, N1_END = N1_START + 8 * H
const N2_START = N1_END + 20 * H, N2_END = N2_START + 8 * H // next night, 20h gap
const ANCHOR_UTC = '2026-07-09T06:00:00.000Z'

describe.skipIf(!canRun)('aggregateOuraRawSamples — bedtime + clustered-night union', () => {
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
      [TEST_USER_ID, `ble-union-${TEST_USER_ID}@example.com`],
    )
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, N2_END, ANCHOR_UTC],
    )

    const rows: string[] = []
    const params: unknown[] = []
    const add = (ds: number, tag: number, name: string, decoded: unknown) => {
      const b = params.length
      rows.push(`($1, $${b + 2}, $${b + 3}, $${b + 4}, 'aa', $${b + 5}::jsonb)`)
      params.push(ds, tag, name, JSON.stringify(decoded))
    }

    // Night 1: a bedtime_period window + sleep signals/HR/HRV inside it.
    add(N1_END, 0x76, 'bedtime_period', { bedtime_start_ds: N1_START, bedtime_end_ds: N1_END })
    // Night 2: NO bedtime — only sleep-signal (0x72) clustering can find it.
    for (const [s, e] of [[N1_START, N1_END], [N2_START, N2_END]] as const) {
      for (let ds = s; ds <= e; ds += H / 2) {          // sleep_acm_period every 30 min
        add(ds, 0x72, 'sleep_acm_period', { acm_mad: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1] })
        add(ds, 0x80, 'ibi_and_amplitude_event', { hr_bpm: [58, 59, 60, 61] }) // ≥3/bin → resting HR
        add(ds, 0x5d, 'hrv_event', { hr_bpm: [58], rmssd_ms: [44], interval_min: 5 })
      }
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

  it('gives the signals-only night its own sleep row with HRV + resting HR, without duplicating the bedtime night', async () => {
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')

    // Assert the rollup's own report BEFORE reading the table. `aggregateOuraRawSamples` isolates
    // each write step and swallows its error into `stepErrors` (adapter.ts) rather than throwing,
    // so a transient write failure lands here as a bare "expected 2, got 0" with the cause
    // invisible — which is exactly how this test's CI flake had to be re-diagnosed from scratch
    // every time. Checking the report first distinguishes the three ways the row count reaches 0:
    // a failed write (stepErrors), no anchor / no windows (sleepSessions === 0), or a genuine
    // miscount (both clean, table wrong). Matches the sibling DB tests, which already assert this.
    expect(result.stepErrors).toEqual([])
    expect(result.sleepSessions).toBe(2)

    const { rows } = await pool.query(
      `SELECT oura_id, average_hrv_ms, lowest_heart_rate FROM sleep_sessions WHERE user_id = $1 ORDER BY sleep_start`,
      [TEST_USER_ID],
    )
    // One row for the bedtime night, one for the clustered night — no duplicate for night 1.
    expect(rows.length).toBe(2)
    const clustered = rows.find(r => r.oura_id === `ble:${N2_START}`)
    expect(clustered).toBeTruthy()
    // The previously-dropped night now carries its window-scoped metrics.
    expect(Number(clustered.average_hrv_ms)).toBe(44)
    expect(Number(clustered.lowest_heart_rate)).toBeGreaterThan(0)

    // And its body_metrics day got HRV + resting HR (the blank-07-09 symptom).
    const { rows: bm } = await pool.query(
      `SELECT count(*)::int AS n FROM body_metrics
         WHERE user_id = $1 AND hrv_ms IS NOT NULL AND resting_heart_rate IS NOT NULL`,
      [TEST_USER_ID],
    )
    expect(bm[0].n).toBeGreaterThanOrEqual(2)
  })
})
