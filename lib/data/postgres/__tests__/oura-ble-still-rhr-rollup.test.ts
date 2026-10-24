// Still-period resting HR (#2634). Proves the rollup stores a completed local day's still-minute
// median HR and its coverage on oura_daily_derived, in a timezone other than Brisbane, and that a
// day too thin to trust stays NULL (never 0). Runs only against a real local dev Postgres.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000ded2'
const TZ = 'America/Los_Angeles'

const DS_PER_DAY = 864_000
const MIN_DS = 600
// The anchor is 13:30 local (PDT, UTC-7) on 2026-07-14, so every frame below sits at local midday.
const END_DS = 50_000_000
const ANCHOR_UTC = '2026-07-14T20:30:00.000Z'
const GOOD_START = END_DS - 3 * 3600 * 10 // 10:30 local
const THIN_START = GOOD_START - DS_PER_DAY // 10:30 local the day before

type Row = { ds: number; tag: number; name: string; decoded: unknown }

/** One 0x50 event of per-minute MET from `from`, and one HR frame per minute. */
function run(from: number, n: number, met: number, bpm: (i: number) => number): Row[] {
  const rows: Row[] = [{ ds: from, tag: 0x50, name: 'activity_information', decoded: { state: 0, met: Array(n).fill(met) } }]
  for (let i = 0; i < n; i++) {
    rows.push({ ds: from + i * MIN_DS + 200, tag: 0x80, name: 'ibi_and_amplitude_event', decoded: { hr_bpm: [bpm(i), bpm(i), bpm(i), bpm(i)] } })
  }
  return rows
}

describe.skipIf(!canRun)('aggregateOuraRawSamples — still-period resting HR', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let stepErrors: string[] = []

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `still-rhr-${TEST_USER_ID}@example.com`, TZ],
    )
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'oura_daily_derived']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(`INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`, [TEST_USER_ID, END_DS, ANCHOR_UTC])

    const rows: Row[] = [
      // 2026-07-14: 90 still minutes (half at 58, half at 62 → median 60), then 10 active minutes at 125
      // that must not count, and HR readings an hour before any MET reading that must not count either.
      ...run(GOOD_START, 90, 1.0, i => (i < 45 ? 58 : 62)),
      ...run(GOOD_START + 90 * MIN_DS, 10, 3.0, () => 125),
      ...Array.from({ length: 40 }, (_, i): Row => ({
        ds: GOOD_START - 2 * 3600 * 10 + i * MIN_DS, tag: 0x80, name: 'ibi_and_amplitude_event', decoded: { hr_bpm: [45, 45, 45, 45] },
      })),
      // 2026-07-13: only 20 still minutes — too thin to store.
      ...run(THIN_START, 20, 1.0, () => 55),
    ]
    const values: string[] = []
    const params: unknown[] = [TEST_USER_ID]
    for (const r of rows) {
      const b = params.length
      values.push(`($1, $${b + 1}, $${b + 2}, $${b + 3}, 'aa', $${b + 4}::jsonb)`)
      params.push(r.ds, r.tag, r.name, JSON.stringify(r.decoded))
    }
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${values.join(',')}`,
      params,
    )
    stepErrors = (await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ)).stepErrors ?? []
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'oura_daily_derived', 'oura_heartrate']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  const derived = async (day: string) => (await pool.query(
    `SELECT still_rhr_bpm, still_rhr_coverage_min FROM oura_daily_derived WHERE user_id = $1 AND day = $2`, [TEST_USER_ID, day],
  )).rows[0]

  it('stores the median of the still minutes and their count for a completed local day', async () => {
    expect(stepErrors.filter(e => e.startsWith('still_rhr'))).toEqual([])
    const row = await derived('2026-07-14')
    expect(Number(row.still_rhr_bpm)).toBe(60)
    expect(Number(row.still_rhr_coverage_min)).toBe(90)
  })

  it('leaves a day with too few still minutes NULL, not 0', async () => {
    const row = await derived('2026-07-13')
    expect(row?.still_rhr_bpm ?? null).toBeNull()
    expect(row?.still_rhr_coverage_min ?? null).toBeNull()
  })
})
