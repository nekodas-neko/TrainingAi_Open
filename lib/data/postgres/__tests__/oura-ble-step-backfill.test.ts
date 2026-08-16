// D0 historical backfill lever: `allowStepsDecrease` on aggregateOuraRawSamples. The steps rollup
// step normally only ever RAISES a stored day's count (the max-merge guard); this flag bypasses
// that guard for a one-time owner-gated backfill that corrects old, inflated flat-30-estimate days
// downward to the real step_counter total. Verifies: (1) default behaviour is unchanged (the guard
// still blocks a decrease when the flag is absent), (2) with the flag set, a lower step_counter
// total DOES overwrite a stored oura_ble value, (3) a higher-ranked `manual` entry is preserved
// regardless of the flag (the sourceMap rank merge in upsertBodyMetrics, not the magnitude guard,
// is what protects it).
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

describe.skipIf(!canRun)('D0 historical backfill (allowStepsDecrease)', () => {
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

  it('default (no flag): the magnitude guard still blocks a decrease on an oura_ble day', async () => {
    // A stale, inflated flat-30-style value stored under oura_ble — higher than step_counter's
    // real total for this sparse fixture (which reads low/zero — see oura-ble-step-rollup.test.ts).
    await setSteps(DAY_MAIN, 9000, 'oura_ble')
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ, { fullHistory: true })
    expect(result.stepErrors).toEqual([])
    expect((await stepsAndSource(DAY_MAIN)).steps).toBe(9000) // unchanged — default behaviour intact
  })

  it('allowStepsDecrease=true: overwrites the inflated oura_ble value with the corrected total', async () => {
    await setSteps(DAY_MAIN, 9000, 'oura_ble')
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ, { fullHistory: true, allowStepsDecrease: true })
    expect(result.stepErrors).toEqual([])
    const after = await stepsAndSource(DAY_MAIN)
    expect(after.steps).not.toBe(9000) // the guard was bypassed — the day was overwritten
    expect(after.source).toBe('oura_ble') // still correctly attributed to the ring
  })

  it('allowStepsDecrease=true: a higher-ranked manual entry is still preserved (sourceMap rank merge)', async () => {
    // Manual (rank 4) always beats oura_ble (rank 3) in the per-field sourceMap merge, independent
    // of the magnitude guard — this is the real protection, not the guard being bypassed here.
    await setSteps(DAY_MAIN, 12345, 'manual')
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ, { fullHistory: true, allowStepsDecrease: true })
    expect(result.stepErrors).toEqual([])
    const after = await stepsAndSource(DAY_MAIN)
    expect(after.steps).toBe(12345) // untouched
    expect(after.source).toBe('manual')
  })

  describe('previewStepsBackfill (read-only dry-run)', () => {
    it('lists an oura_ble day whose stored value would actually change', async () => {
      await setSteps(DAY_MAIN, 9000, 'oura_ble')
      const preview = await repo.previewStepsBackfill(TEST_USER_ID, TZ)
      const row = preview.find(r => r.date === DAY_MAIN)
      expect(row).toBeTruthy()
      expect(row!.oldSteps).toBe(9000)
      expect(row!.oldSource).toBe('oura_ble')
      expect(row!.newSteps).not.toBe(9000)
    })

    it('never lists a manual day (mirrors the real write protection exactly)', async () => {
      await setSteps(DAY_MAIN, 12345, 'manual')
      const preview = await repo.previewStepsBackfill(TEST_USER_ID, TZ)
      expect(preview.find(r => r.date === DAY_MAIN)).toBeUndefined()
    })

    it('never lists a day whose value already matches (nothing would change)', async () => {
      // Seed the stored value to exactly what step_counter would compute, then confirm the day
      // drops out of the preview (oldSteps === newSteps). Explicitly re-seed as oura_ble first —
      // a prior test in this file may have left DAY_MAIN as `manual` (protected/excluded).
      await setSteps(DAY_MAIN, 9000, 'oura_ble')
      const first = await repo.previewStepsBackfill(TEST_USER_ID, TZ)
      const row = first.find(r => r.date === DAY_MAIN)
      expect(row).toBeTruthy()
      await setSteps(DAY_MAIN, row!.newSteps, 'oura_ble')
      const second = await repo.previewStepsBackfill(TEST_USER_ID, TZ)
      expect(second.find(r => r.date === DAY_MAIN)).toBeUndefined()
    })

    it('is read-only — running it never writes to body_metrics', async () => {
      await setSteps(DAY_MAIN, 9000, 'oura_ble')
      await repo.previewStepsBackfill(TEST_USER_ID, TZ)
      expect((await stepsAndSource(DAY_MAIN)).steps).toBe(9000) // unchanged by the preview itself
    })
  })

  // The preview is the DRY RUN the owner authorises a destructive backfill from. It used to be a
  // hand-copied duplicate of the rollup's steps block, and the 2026-07-28 midnight-split fix landed
  // in only one copy. Both now call computeStepsByDay; this pins them to the same answer so they
  // cannot silently diverge again.
  it('the preview reports exactly what the backfill would write', async () => {
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, steps, source_map)
         VALUES ($1, $2, 999999, '{"steps":"oura_ble"}'::jsonb)
       ON CONFLICT (user_id, date) DO UPDATE SET steps = 999999, source_map = '{"steps":"oura_ble"}'::jsonb`,
      [TEST_USER_ID, DAY_MAIN],
    )

    const preview = await repo.previewStepsBackfill(TEST_USER_ID, TZ)
    const previewed = preview.find(r => r.date === DAY_MAIN)
    expect(previewed).toBeDefined()

    // Now actually run the backfill and compare what landed against what was promised.
    await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ, { allowStepsDecrease: true })
    const { rows } = await pool.query(
      `SELECT steps FROM body_metrics WHERE user_id = $1 AND date = $2`, [TEST_USER_ID, DAY_MAIN])
    expect(rows[0].steps).toBe(previewed!.newSteps)
  })

})
