// Ring daily-steps rollup: real captured 0x7e/0x7f frames → aggregateOuraRawSamples →
// body_metrics.steps. Since D0 the source is Oura's `step_counter` model (not the retired
// flat-30 col14 estimate). This test verifies the WIRING end-to-end: the rollup runs
// step_counter per local day, buckets frames by day, merges accurate live-counted windows
// (Tier-2 override), applies the max-merge guard (never regresses a higher stored count), and
// is idempotent.
//
// NB: step_counter returns 0 steps on these tiny calibration fixtures (3–7 isolated windows are
// far too sparse for the model to fire — it needs continuous real-day data + the motion stream).
// So the deterministic, non-zero signal here is the LIVE windows; the per-day expected total is
// computed self-consistently via the same pipeline + merge, so the assertions track the model
// instead of hard-coding brittle magic numbers. Real-day step totals are physiologically-sane
// only verifiable on-device (the D0 device gate).
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { hasRealConstants } from '@/lib/oura-models/__fixtures__/real-constants'

// The model runs from a recording of itself, so this suite needs no `.onnx` file — see
// `lib/oura-models/inference/__tests__/helpers/replay-session.ts`. The code under test here is ours
// and still runs for real.
vi.mock('@/lib/oura-models/inference/session', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/oura-models/inference/session')>()
  const { makeReplayGetSession } = await import('@/lib/oura-models/inference/__tests__/helpers/replay-session')
  return { ...actual, getSession: makeReplayGetSession(actual.getSession) }
})

import { runStepCounterPipeline, type RawFrame } from '@/lib/oura-ble/step-counter-pipeline'
import { mergeStepCounterWithLive, type StepCountWindow } from '@trainingai/shared/health/step-estimate'
import { measuredAtMs } from '@/lib/oura-ble/decode'
import { nodeModelRuntime } from '@/lib/oura-models/inference/runtime-node'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000d011'
const TZ = 'Australia/Brisbane'

// Fixed anchor: ds 4400000 ↔ 2026-07-08T02:00:00Z (noon AEST), so every frame lands on a
// deterministic local day no matter when the test runs.
const ANCHOR_DS = 4400000
const ANCHOR_UTC = '2026-07-08T02:00:00Z'
const ANCHOR_UTC_MS = Date.parse(ANCHOR_UTC)
const DAY_MAIN = '2026-07-08'
const DAY_PREV = '2026-07-07'
const DS_DAY_SHIFT = 24 * 3600 * 10

type Cap = [number, string, string]
// Real captured frames (owner calibration, 2026-07-10) — same fixtures as
// lib/__tests__/step-estimate.test.ts.
const WALK_100: Cap[] = [
  [4210916, '67b84f1e595e5a889e2b7601575f', '344aaa1a87a52254123bc9625fd2'],
  [4211215, '97956002455c1f5ec261e00a284a', '000dc461b78648600116cc8b4d8f'],
  [4211514, 'b9599e8b307c010cc05fd6812966', '0011c34eeb00005f0007c189573b'],
]
const WALK_200: Cap[] = [
  [4316504, 'ca61b3816965000baa5058893850', '764794519381194a0339ca993bd3'],
  [4316809, 'ab646b136d510b578f83608d665f', '133472f73c17412b705f9e5b7207'],
  [4317109, '90be4e1e3d006368c762da813a54', '010bbf6381854a762b2ccc8e49b8'],
  [4317409, 'bd53c011294d0014bf55ad05484e', '010aad52ae895f2f031dbe7a5f9d'],
  [4317705, 'bf52d20119660008bc5ea8853e7a', '0210b555850156610118c07058cf'],
  [4318005, 'c263c7011c7a020abe537d855b71', '061bb25f96824733153dcb8c432f'],
  [4318306, 'ba64ab823b85020eba62ca8a2d6b', '0111ab2c5622277e378dc98f3cb1'],
]
const DESK_NOWALK: Cap[] = [
  [4346510, 'bd765395374c786a908646ae344b', '4b9a8acd4b8a4d533d75af4285b9'],
  [4346808, 'abd12a944e5d766eac0000ac3a00', '9353b8a852e3314f8d44b54592cd'],
  [4347111, 'b0f0543641008a5dbee149393b00', 'a04fa4ce34944251736bb3468d31'],
  [4347410, '487838403830a737b1cf3cb93733', 'a545bf0f1f354b009b49b43e8963'],
  [4347713, '9a00002a4e00757f450736643f26', '9d43909a202045275e8ab548a529'],
]

// The same per-day frames the rollup buckets, as RawFrames for the pipeline.
const rawFrames = (caps: Cap[], dsShift = 0): RawFrame[] =>
  caps.flatMap(([ds, f1, f2]): RawFrame[] => [
    { ringTimestampDs: ds + dsShift, tag: 0x7e, bodyHex: f1 },
    { ringTimestampDs: ds + dsShift + 1, tag: 0x7f, bodyHex: f2 },
  ])
const MAIN_FRAMES = [...rawFrames(WALK_200), ...rawFrames(DESK_NOWALK)]
const PREV_FRAMES = rawFrames(WALK_100, -DS_DAY_SHIFT)

const liveMs = (startDs: number, endDs: number, steps: number): StepCountWindow => ({
  startMs: measuredAtMs(startDs, ANCHOR_DS, ANCHOR_UTC_MS),
  endMs: measuredAtMs(endDs, ANCHOR_DS, ANCHOR_UTC_MS),
  steps,
})

// The value the rollup should persist for a day: step_counter over that day's frames, merged with
// any live windows (Tier-2 override) — computed with the SAME anchor the rollup uses.
const expectedSteps = async (frames: RawFrame[], live: StepCountWindow[]): Promise<number> => {
  const r = await runStepCounterPipeline(frames, [], (ds) => measuredAtMs(ds, ANCHOR_DS, ANCHOR_UTC_MS), nodeModelRuntime)
  return mergeStepCounterWithLive(r?.stepWindows ?? [], live)
}

describe.skipIf(!canRun)('ring daily-steps rollup (0x7e/0x7f → step_counter → body_metrics.steps)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const insertCaps = async (caps: Cap[], dsShift = 0) => {
    for (const [ds, f1, f2] of caps) {
      await pool.query(
        `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES
           ($1, $2, 126, 'real_step_event_feature_1', $3, NULL),
           ($1, $4, 127, 'real_step_event_feature_2', $5, NULL)`,
        [TEST_USER_ID, ds + dsShift, f1, ds + dsShift + 1, f2],
      )
    }
  }

  const stepsFor = async (date: string): Promise<number | null> => {
    const { rows } = await pool.query(
      `SELECT steps FROM body_metrics WHERE user_id = $1 AND date = $2`,
      [TEST_USER_ID, date],
    )
    return rows[0]?.steps ?? null
  }

  const resetSteps = async (date: string, value: number, source = 'oura_ble') => {
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
      [TEST_USER_ID, `ble-steps-${TEST_USER_ID}@example.com`, TZ],
    )
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM step_live_windows WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, ANCHOR_DS, ANCHOR_UTC],
    )

    // DAY_PREV: the 100-step walk shifted back a day. DAY_MAIN: the 200-step walk + a
    // desk-typing session.
    await insertCaps(WALK_100, -DS_DAY_SHIFT)
    await insertCaps(WALK_200)
    await insertCaps(DESK_NOWALK)
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM step_live_windows WHERE user_id = $1`, [TEST_USER_ID])
  })

  // The expected totals are step_counter's own output through the vendor's dequantization table,
  // so without it both sides are synthetic and the assertion says nothing. The eight blocks below
  // assert merge, idempotence, source ranking and midnight splitting against values this suite
  // writes itself, and hold either way.
  it.skipIf(!hasRealConstants())('runs step_counter per local day without errors and persists its per-day total', async () => {
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ)
    expect(result.stepErrors).toEqual([])
    // step_counter over each day's frames. The assertion tracks the model output, not a magic
    // number (the model fires on real walk frames — post the 2026-07-22 column-order fix — so both
    // days get a sane non-zero total; a day with 0 gait windows would stay absent past the guard).
    const expMain = await expectedSteps(MAIN_FRAMES, [])
    const expPrev = await expectedSteps(PREV_FRAMES, [])
    expect(await stepsFor(DAY_MAIN)).toBe(expMain > 0 ? expMain : null)
    expect(await stepsFor(DAY_PREV)).toBe(expPrev > 0 ? expPrev : null)
  })

  it('credits an accurate live-counted window to the day of its start (Tier-2 merge)', async () => {
    // Reset DAY_MAIN so the merged value writes fresh (the max-merge guard would otherwise keep the
    // prior test's model-only baseline if it were higher). A live-counted walk of 120 steps on
    // DAY_MAIN overrides step_counter's per-window output for the span it covers; the model fills the
    // rest; the merged total is credited to DAY_MAIN. DAY_PREV keeps its own model total (untouched).
    await resetSteps(DAY_MAIN, 0)
    const first = 4316504
    const third = 4317109
    await repo.upsertStepLiveWindow(TEST_USER_ID, { startDs: first, endDs: third + 300, steps: 120 })
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ)
    expect(result.stepErrors).toEqual([])
    const expMain = await expectedSteps(MAIN_FRAMES, [liveMs(first, third + 300, 120)])
    expect(await stepsFor(DAY_MAIN)).toBe(expMain)
    expect(await stepsFor(DAY_PREV)).toBe(await expectedSteps(PREV_FRAMES, [])) // sibling = its own model total
  })

  it('re-running the rollup is idempotent', async () => {
    const before = await stepsFor(DAY_MAIN)
    await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ)
    expect(await stepsFor(DAY_MAIN)).toBe(before)
  })

  it('re-posting the same live window (same start_ds) is idempotent, not additive', async () => {
    await resetSteps(DAY_MAIN, 0) // write the fresh merged value regardless of the prior baseline
    const first = 4316504
    const third = 4317109
    await repo.upsertStepLiveWindow(TEST_USER_ID, { startDs: first, endDs: third + 300, steps: 150 })
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ)
    expect(result.stepErrors).toEqual([])
    const expMain = await expectedSteps(MAIN_FRAMES, [liveMs(first, third + 300, 150)])
    expect(await stepsFor(DAY_MAIN)).toBe(expMain) // updated in place, not summed with the prior 120
  })

  it('max-merge: never regresses a higher stored count', async () => {
    await resetSteps(DAY_MAIN, 9000)
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ)
    expect(result.stepErrors).toEqual([])
    expect(await stepsFor(DAY_MAIN)).toBe(9000) // stored value wins — the live/model total is lower
  })

  // The guard used to compare raw counts with no regard for who wrote them, so a lower-ranked
  // source won purely by being bigger — the ring's honest total never even reached `mergeSet`,
  // which would have accepted it. The guard's remit is monotonic accumulation within the ring's
  // own writes; protecting higher-ranked sources is `mergeSet`'s job and it does it per-field.
  it('lets the ring correct a LOWER-ranked source downward, however big that source’s number was', async () => {
    await resetSteps(DAY_MAIN, 9000, 'health_connect')
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ)
    expect(result.stepErrors).toEqual([])
    const after = await stepsFor(DAY_MAIN)
    expect(after).not.toBe(9000)
    expect(after).toBeLessThan(9000)
  })

  it('still refuses to lower a HIGHER-ranked source, however small the ring’s number', async () => {
    // The other half of the same rule — rank decides, not magnitude, in both directions.
    await resetSteps(DAY_MAIN, 9000, 'manual')
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ)
    expect(result.stepErrors).toEqual([])
    expect(await stepsFor(DAY_MAIN)).toBe(9000)
  })

  // A window crossing local midnight used to be credited WHOLE to its start day, and its span was
  // then absent from the next day's live list — so the next day's model windows over that same span
  // were never dropped and the overlap was paid for twice, on both days.
  it('splits a midnight-crossing live window across both days, pro-rata', async () => {
    await pool.query(`DELETE FROM step_live_windows WHERE user_id = $1`, [TEST_USER_ID])
    await resetSteps(DAY_MAIN, 0)
    await resetSteps(DAY_PREV, 0)

    // Local midnight between DAY_PREV and DAY_MAIN, as a ds. 20 minutes either side, 600 steps.
    const midnightMs = Date.parse('2026-07-07T14:00:00Z') // 2026-07-08 00:00 Brisbane
    const midnightDs = ANCHOR_DS - Math.round((ANCHOR_UTC_MS - midnightMs) / 100)
    const startDs = midnightDs - 20 * 60 * 10
    const endDs = midnightDs + 20 * 60 * 10
    await repo.upsertStepLiveWindow(TEST_USER_ID, { startDs, endDs, steps: 600 })

    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ)
    expect(result.stepErrors).toEqual([])

    // Half the span falls on each day, so each day gets half the steps — and neither day is
    // credited the other's share.
    const prev = await stepsFor(DAY_PREV)
    const main = await stepsFor(DAY_MAIN)
    expect(prev).not.toBeNull()
    expect(main).not.toBeNull()
    // The pre-fix behaviour credited all 600 to DAY_PREV; each day now carries ~300 of them.
    expect(prev!).toBeLessThan(600)
    expect(main!).toBeGreaterThanOrEqual(300)
    expect(prev! + main!).toBeLessThanOrEqual(600 + (await expectedSteps(MAIN_FRAMES, [])) + (await expectedSteps(PREV_FRAMES, [])))
  })

  it('a live window with no matching frames still contributes its steps standalone', async () => {
    // Far outside any captured frame's ds — a pocket walk tracked live with no ring gait frames.
    await pool.query(`DELETE FROM step_live_windows WHERE user_id = $1`, [TEST_USER_ID])
    await resetSteps(DAY_MAIN, 0)
    await repo.upsertStepLiveWindow(TEST_USER_ID, { startDs: 4_500_000, endDs: 4_500_900, steps: 42 })
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ)
    expect(result.stepErrors).toEqual([])
    const expMain = await expectedSteps(MAIN_FRAMES, [liveMs(4_500_000, 4_500_900, 42)])
    expect(await stepsFor(DAY_MAIN)).toBe(expMain)
  })
})
