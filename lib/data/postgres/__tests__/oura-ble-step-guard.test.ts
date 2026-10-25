// The steps rollup step only ever RAISES a stored day's count (the max-merge guard) within the
// ring's own writes, and a higher-ranked `manual` entry is preserved by the sourceMap rank merge in
// upsertBodyMetrics rather than by that guard. (The `allowStepsDecrease` lever that lifted the
// guard for the D0 backfill, and its preview, were retired in #2862.)
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000d018'
const TZ = 'Australia/Brisbane'

const ANCHOR_DS = 4400000
const ANCHOR_UTC = '2026-07-08T02:00:00Z'
const DAY_MAIN = '2026-07-08'

type Cap = [number, string, string]
// Real captured frames (owner calibration, 2026-07-10) — a 200-step walk, same fixtures used
// elsewhere in the step-counter test suite.
const WALK_200: Cap[] = [
  [4316504, 'ca61b3816965000baa5058893850', '764794519381194a0339ca993bd3'],
  [4316809, 'ab646b136d510b578f83608d665f', '133472f73c17412b705f9e5b7207'],
  [4317109, '90be4e1e3d006368c762da813a54', '010bbf6381854a762b2ccc8e49b8'],
  [4317409, 'bd53c011294d0014bf55ad05484e', '010aad52ae895f2f031dbe7a5f9d'],
  [4317705, 'bf52d20119660008bc5ea8853e7a', '0210b555850156610118c07058cf'],
  [4318005, 'c263c7011c7a020abe537d855b71', '061bb25f96824733153dcb8c432f'],
  [4318306, 'ba64ab823b85020eba62ca8a2d6b', '0111ab2c5622277e378dc98f3cb1'],
]

describe.skipIf(!canRun)('step rollup guard', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const insertCaps = async (caps: Cap[]) => {
    for (const [ds, f1, f2] of caps) {
      await pool.query(
        `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES
           ($1, $2, 126, 'real_step_event_feature_1', $3, NULL),
           ($1, $4, 127, 'real_step_event_feature_2', $5, NULL)`,
        [TEST_USER_ID, ds, f1, ds + 1, f2],
      )
    }
  }

  const stepsAndSource = async (date: string): Promise<{ steps: number | null; source: string | null }> => {
    const { rows } = await pool.query(
      `SELECT steps, source_map->>'steps' AS source FROM body_metrics WHERE user_id = $1 AND date = $2`,
      [TEST_USER_ID, date],
    )
    return rows[0] ?? { steps: null, source: null }
  }

  const setSteps = async (date: string, value: number, source: string) => {
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, steps, source_map)
         VALUES ($1, $2, $3, jsonb_build_object('steps', $4::text))
       ON CONFLICT (user_id, date) DO UPDATE SET steps = EXCLUDED.steps, source_map = EXCLUDED.source_map`,
      [TEST_USER_ID, date, value, source],
    )
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `ble-steps-backfill-${TEST_USER_ID}@example.com`, TZ],
    )
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, ANCHOR_DS, ANCHOR_UTC],
    )
    await insertCaps(WALK_200)
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [TEST_USER_ID])
  })

  it('the magnitude guard blocks a decrease on an oura_ble day', async () => {
    // A stale, inflated flat-30-style value stored under oura_ble — higher than step_counter's
    // real total for this sparse fixture (which reads low/zero — see oura-ble-step-rollup.test.ts).
    await setSteps(DAY_MAIN, 9000, 'oura_ble')
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ, { fullHistory: true })
    expect(result.stepErrors).toEqual([])
    expect((await stepsAndSource(DAY_MAIN)).steps).toBe(9000) // unchanged
  })

  it('a higher-ranked manual entry is preserved (sourceMap rank merge)', async () => {
    // Manual (rank 4) always beats oura_ble (rank 3) in the per-field sourceMap merge, independent
    // of the magnitude guard.
    await setSteps(DAY_MAIN, 12345, 'manual')
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ, { fullHistory: true })
    expect(result.stepErrors).toEqual([])
    const after = await stepsAndSource(DAY_MAIN)
    expect(after.steps).toBe(12345) // untouched
    expect(after.source).toBe('manual')
  })
})
