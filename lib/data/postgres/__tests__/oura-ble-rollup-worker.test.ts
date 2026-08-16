// Q-213 Stage 2: the BLE rollup runs in a `worker_threads` realm so it cannot starve the request
// loop. Stage 1 narrowed the window from 35 days to the touched span (15–30 min → 2 min in
// production) and that was still not enough — on 2026-08-13 15:47:33 a concurrent
// `POST /api/oura-ble/samples` returned 500 after 27.6 s, `getNewestOuraClockAnchorByUtc` failing
// with `Connection terminated due to connection timeout` while a two-minute rollup held the thread.
// `pg`'s connect timeout is a JS timer: on a blocked loop it fires late and kills healthy
// connections. A non-2xx there holds the ring's history cursor and re-drains — the storm mechanism.
//
// Two things have to be true, and only the second is new:
//   1. the worker produces the same rows the in-process run does, and
//   2. the main thread keeps running while it does.
//
// Named `oura-ble-*` deliberately: `vitest.config.ts` gives that glob its own project with a 60 s
// timeout because these run a full `aggregateOuraRawSamples` pass. Outside it this inherits 5 s and
// becomes the next false alarm.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasRealModels } from '@/lib/oura-models/__fixtures__/real-constants'
import { existsSync } from 'fs'
import path from 'path'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000213002'

const DS_PER_DAY = 24 * 3600 * 10
const NOW_DS = 60_000_000
const ANCHOR_UTC = '2026-07-20T21:00:00.000Z'
const NIGHT_START = NOW_DS - 1 * DS_PER_DAY
const NIGHT_END = NIGHT_START + 8 * 3600 * 10

const WORKER_BUNDLE = path.join(process.cwd(), '.rollup-worker', 'rollup-worker.cjs')

async function seedNight(pool: import('pg').Pool) {
  await pool.query(
    `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded)
     VALUES ($1, $2, 118, 'bedtime_period', 'deadbeef', $3)`,
    [TEST_USER_ID, NIGHT_END, JSON.stringify({ bedtime_start_ds: NIGHT_START, bedtime_end_ds: NIGHT_END })],
  )
  const hr = Array.from({ length: 60 }, (_, i) => 52 + (i % 10))
  const decoded = JSON.stringify({ hr_bpm: hr })
  const values: string[] = []
  const params: unknown[] = []
  for (let r = 0; r < 200; r++) {
    const ds = NIGHT_START + Math.floor((r / 200) * (NIGHT_END - NIGHT_START))
    const b = params.length
    values.push(`($1, $${b + 2}, 128, 'ibi_and_amplitude_event', 'aa', $${b + 3}::jsonb)`)
    params.push(ds, decoded)
  }
  await pool.query(
    `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${values.join(',')}`,
    [TEST_USER_ID, ...params],
  )
}

/** Resets everything the rollup writes, so two runs start from the same state. */
async function resetDerived(pool: import('pg').Pool) {
  for (const t of ['sleep_sessions', 'body_metrics', 'oura_heartrate', 'oura_rollup_state']) {
    await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
  }
}

/**
 * Runs `fn` while sampling how late a 20 ms interval fires. On a blocked loop the timer cannot run
 * at all, so the largest gap is the length of the block — this is the same mechanism that made
 * `pg`'s connect timeout fire late during the outage.
 */
async function withLoopLag<T>(fn: () => Promise<T>): Promise<{ value: T; maxLagMs: number; elapsedMs: number }> {
  let last = Date.now()
  let maxLagMs = 0
  const timer = setInterval(() => {
    const now = Date.now()
    maxLagMs = Math.max(maxLagMs, now - last - 20)
    last = now
  }, 20)
  const t0 = Date.now()
  try {
    const value = await fn()
    return { value, maxLagMs, elapsedMs: Date.now() - t0 }
  } finally {
    clearInterval(timer)
  }
}

describe.skipIf(!canRun)('BLE rollup worker (Q-213 Stage 2)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    // `pnpm test` does not run `pnpm build`, so in CI the bundle does not exist yet — and without it
    // every assertion here would quietly measure the in-process fallback instead. Building it from
    // source also means these tests can never run against a stale bundle.
    const { buildRollupWorker } = await import('../../../../scripts/build-rollup-worker.mjs')
    await buildRollupWorker()

    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `ble-rollup-worker-${TEST_USER_ID}@example.com`],
    )
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics', 'oura_heartrate', 'oura_rollup_state']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, NOW_DS, ANCHOR_UTC],
    )
    await seedNight(pool)
  })

  afterAll(async () => {
    const { __stopRollupWorker } = await import('@/lib/oura-ble/rollup-worker')
    await __stopRollupWorker()
  })

  it('has a bundle to load — without it every assertion below silently tests the fallback', () => {
    expect(existsSync(WORKER_BUNDLE)).toBe(true)
  })

  it('writes what the in-process run writes', async () => {
    const { runRollupOffLoop } = await import('@/lib/oura-ble/rollup-worker')

    await resetDerived(pool)
    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')
    const inProcess = await snapshot(pool)

    await resetDerived(pool)
    await runRollupOffLoop(TEST_USER_ID, 'Australia/Brisbane')
    const viaWorker = await snapshot(pool)

    expect(viaWorker.sleep).toEqual(inProcess.sleep)
    expect(viaWorker.hrPoints).toEqual(inProcess.hrPoints)
    expect(viaWorker.metrics).toEqual(inProcess.metrics)
    // A pair of empty snapshots would satisfy every assertion above without the rollup doing
    // anything at all.
    expect(inProcess.hrPoints).toBeGreaterThan(0)
  })

  it('runs the admin redecode both-phases job, isolating each phase', async () => {
    const { runRedecodeOffLoop } = await import('@/lib/oura-ble/rollup-worker')

    await resetDerived(pool)
    const phases = await runRedecodeOffLoop(TEST_USER_ID, 'Australia/Brisbane', { fullHistory: true }, true)

    // The route's contract: per-phase results, and neither phase can fail the request.
    expect(phases.redecodeError).toBeNull()
    expect(phases.aggregateError).toBeNull()
    expect(phases.redecoded).not.toBeNull()
    expect(phases.aggregated).not.toBeNull()
    // It really walked the rows rather than returning an empty shell.
    expect(phases.redecoded!.scanned).toBeGreaterThan(0)

    const viaWorker = await snapshot(pool)
    await resetDerived(pool)
    await repo.redecodeOuraRawSamples(TEST_USER_ID)
    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane', { fullHistory: true })
    expect(viaWorker).toEqual(await snapshot(pool))
  })

  it('the dumpOnly path skips the redecode phase', async () => {
    const { runRedecodeOffLoop } = await import('@/lib/oura-ble/rollup-worker')
    const phases = await runRedecodeOffLoop(TEST_USER_ID, 'Australia/Brisbane', { dumpOnly: true }, false)
    expect(phases.redecoded).toBeNull()
    expect(phases.redecodeError).toBeNull()
  })

  // The only test in this file that needs the vendored `.onnx` on disk (Q-49 A4b removed them).
  // Its siblings compare rows and run from a recording; this one compares *durations*, and the
  // models are where the duration comes from. With `getSession` returning null every caller falls
  // back and the whole rollup finishes in ~65 ms, which trips the degenerate-comparison guard
  // below — correctly. That guard is the test being honest about its own preconditions, so this
  // skips rather than being relaxed to accommodate a workload that is no longer being measured.
  it.skipIf(!hasRealModels())('leaves the main thread free while it runs', async () => {
    const { runRollupOffLoop } = await import('@/lib/oura-ble/rollup-worker')

    await resetDerived(pool)
    const blocking = await withLoopLag(() => repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane'))

    await resetDerived(pool)
    const offLoop = await withLoopLag(() => runRollupOffLoop(TEST_USER_ID, 'Australia/Brisbane'))

    // Guard against a degenerate comparison: if neither run took real time, the lag numbers mean
    // nothing and this test would pass on any implementation.
    expect(blocking.elapsedMs).toBeGreaterThan(100)
    expect(offLoop.elapsedMs).toBeGreaterThan(100)

    // Stated as a FRACTION of each run, not a millisecond budget, so the thresholds do not depend on
    // how fast the machine is — an absolute cap that a slow CI runner can trip is how a real signal
    // becomes a flake, and an absolute cap loose enough to be safe (250 ms) would have passed the
    // blocking run too. Measured locally: worker 4 ms of lag across a 439 ms run; in-process 185 ms
    // across 262 ms — the loop was gone for 71% of it.
    expect(offLoop.maxLagMs).toBeLessThan(offLoop.elapsedMs * 0.25)

    // The control. Without it the assertion above could hold because the rollup got cheap rather
    // than because it moved off the loop. If someone later makes the in-process path yield
    // cooperatively this line fails — correctly: the comparison it anchors would no longer mean
    // anything, and the test should be re-derived rather than relaxed.
    expect(blocking.maxLagMs).toBeGreaterThan(blocking.elapsedMs * 0.25)
  })
})

async function snapshot(pool: import('pg').Pool) {
  const sleep = await pool.query(
    `SELECT date, duration_hours, deep_sleep_hours, rem_sleep_hours, avg_heart_rate, average_hrv_ms, sleep_phase_5_min
       FROM sleep_sessions WHERE user_id = $1 ORDER BY date`,
    [TEST_USER_ID],
  )
  const hr = await pool.query(`SELECT count(*)::int AS n FROM oura_heartrate WHERE user_id = $1`, [TEST_USER_ID])
  const metrics = await pool.query(
    `SELECT date, resting_heart_rate, hrv_ms FROM body_metrics WHERE user_id = $1 ORDER BY date`,
    [TEST_USER_ID],
  )
  return { sleep: sleep.rows, hrPoints: hr.rows[0].n as number, metrics: metrics.rows }
}
