// Q-536: migration 189 merges the clock "epochs" that a history re-drain opened.
//
// The migration decides what to merge from measured evidence rather than from a user id or an
// epoch number — two epochs are the same ring clock when their MINIMUM anchor lag agrees, because
// a re-drain leaves that minimum untouched while a genuine re-key moves the ring's origin by weeks.
// The half worth testing hardest is therefore the one that must NOT happen: a real reset being
// swallowed. Both are covered below.
//
// The migration is executed the way `ensureSchema` executes it — one `pool.query()` with the whole
// file — so the `ON COMMIT DROP` temp table is exercised under the production execution path and
// not a friendlier one.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDsToMs, type ClockAnchor } from '@/lib/oura-ble/clock'

const canRun = !!process.env.DATABASE_URL
const REDRAIN_USER = '00000000-0000-4000-8000-0000000536a1'
const REKEY_USER = '00000000-0000-4000-8000-0000000536a2'

const MIGRATION = readFileSync(
  join(process.cwd(), 'lib/data/postgres/migrations/189_q536_merge_redrain_clock_epochs.sql'),
  'utf8',
)

const RING_ORIGIN_SEC = 1_783_237_659

/**
 * The measured production shape: one continuous ring clock, split into four labelled epochs by two
 * re-drains.
 *
 * The anchors are generated from the *mechanism* rather than from hand-authored lags, because a
 * hand-authored fixture gets this wrong in a way that hides the bug. A first draft gave each drained
 * epoch two anchors — and with n=2, `robustOffsetMs`'s p10 index is 0, so it returned the clean
 * minimum and the contamination vanished. What actually contaminates the estimate is the *shape*: a
 * drain replays days of ds inside a ~40-minute wall-clock window, so lag falls monotonically from
 * the whole replayed span down to ~0, and the p10 lands a tenth of the way up that ramp. In
 * production that is 695 anchors over 4.75 days, putting p10 14.16 h out.
 */
function anchorsFor(epoch: number, dsFrom: number, dsTo: number, opts: { drain: boolean }) {
  const N = 40
  const TRANSPORT_SEC = 5
  const DRAIN_WINDOW_SEC = 2400
  const rows: Array<{ ds: number; utcSec: number; epoch: number }> = []
  // A drain replays history inside one short window that ENDS as the newest event is delivered —
  // so the last anchor of a drain is as prompt as any steady-state one, and the epoch's *minimum*
  // lag is therefore unchanged. That is precisely why the minimum discriminates a re-drain from a
  // re-key, and why a generator that leaves the newest anchor late would defeat the merge criterion
  // instead of testing it.
  const drainEndSec = RING_ORIGIN_SEC + dsTo / 10 + TRANSPORT_SEC
  for (let i = 0; i < N; i++) {
    const ds = Math.round(dsFrom + ((dsTo - dsFrom) * i) / (N - 1))
    const utcSec = opts.drain
      ? drainEndSec - DRAIN_WINDOW_SEC * (1 - i / (N - 1))
      : RING_ORIGIN_SEC + ds / 10 + TRANSPORT_SEC
    rows.push({ ds, utcSec, epoch })
  }
  return rows
}

const REDRAIN_ANCHORS = [
  ...anchorsFor(0, 20_495_267, 21_444_831, { drain: false }),
  ...anchorsFor(1, 17_396_647, 21_469_936, { drain: true }),   // 2026-07-30 re-drain
  ...anchorsFor(2, 21_470_017, 37_112_321, { drain: false }),
  ...anchorsFor(3, 33_006_208, 37_146_216, { drain: true }),   // 2026-08-17 re-drain
]

describe.skipIf(!canRun)('migration 189 — merging re-drain clock epochs (Q-536)', () => {
  let pool: import('pg').Pool

  const epochsOf = async (table: string, userId: string) => (await pool.query(
    `SELECT epoch, count(*)::int AS n FROM ${table} WHERE user_id = $1 GROUP BY epoch ORDER BY epoch`,
    [userId],
  )).rows.map(r => ({ epoch: r.epoch as number, n: r.n as number }))

  const anchorsOf = async (userId: string): Promise<ClockAnchor[]> => (await pool.query(
    `SELECT epoch, anchor_ds::bigint AS ds, anchor_utc FROM oura_ble_clock_anchors WHERE user_id = $1`,
    [userId],
  )).rows.map(r => ({
    epoch: r.epoch as number,
    anchorDs: Number(r.ds),
    anchorUtcMs: new Date(r.anchor_utc as string).getTime(),
  }))

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    for (const [id, label] of [[REDRAIN_USER, 'redrain'], [REKEY_USER, 'rekey']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone)
         VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
        [id, `q536-${label}-${id}@example.com`],
      )
    }
  })

  beforeEach(async () => {
    for (const id of [REDRAIN_USER, REKEY_USER]) {
      await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM oura_rollup_state WHERE user_id = $1`, [id])
    }

    for (const { ds, utcSec, epoch } of REDRAIN_ANCHORS) {
      await pool.query(
        `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc, epoch, observed_source)
         VALUES ($1, $2, to_timestamp($3), $4, 'drain')`,
        [REDRAIN_USER, ds, utcSec, epoch],
      )
      await pool.query(
        `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, epoch)
         VALUES ($1, $2, 118, 'x', $3, $4) ON CONFLICT DO NOTHING`,
        [REDRAIN_USER, ds, `aa${epoch}`, epoch],
      )
    }
    await pool.query(
      `INSERT INTO oura_rollup_state (user_id, last_rolled_ds, epoch) VALUES ($1, 37112321, 3)`,
      [REDRAIN_USER],
    )

    // A genuine re-key: the counter restarts near zero, so the ring's origin — and therefore the
    // minimum lag — moves by however long the ring had been running. Weeks, here.
    const rekeyOrigin = RING_ORIGIN_SEC + 2_000_000
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc, epoch, observed_source)
       VALUES ($1, 20000000, to_timestamp($2), 0, 'drain'),
              ($1, 50000,    to_timestamp($3), 1, 'drain')`,
      [REKEY_USER, RING_ORIGIN_SEC + 2_000_000, rekeyOrigin + 5_000],
    )
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, epoch)
       VALUES ($1, 20000000, 118, 'x', 'bb', 0), ($1, 50000, 118, 'x', 'cc', 1)`,
      [REKEY_USER],
    )
    await pool.query(
      `INSERT INTO oura_rollup_state (user_id, last_rolled_ds, epoch) VALUES ($1, 50000, 1)`,
      [REKEY_USER],
    )
  })

  afterAll(async () => {
    for (const id of [REDRAIN_USER, REKEY_USER]) {
      await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM oura_rollup_state WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  it('collapses the four re-drain epochs into one, on anchors and samples alike', async () => {
    expect(await epochsOf('oura_ble_clock_anchors', REDRAIN_USER)).toHaveLength(4)

    await pool.query(MIGRATION)

    const anchors = await epochsOf('oura_ble_clock_anchors', REDRAIN_USER)
    expect(anchors).toEqual([{ epoch: 0, n: REDRAIN_ANCHORS.length }])
    expect(await epochsOf('oura_raw_samples', REDRAIN_USER)).toHaveLength(1)
  })

  // The half that must not regress. A migration that merged everything would also pass the test
  // above, so this is the one carrying the safety claim.
  it('leaves a genuine re-key alone — its epochs, samples and watermark are untouched', async () => {
    await pool.query(MIGRATION)

    expect(await epochsOf('oura_ble_clock_anchors', REKEY_USER)).toEqual([
      { epoch: 0, n: 1 }, { epoch: 1, n: 1 },
    ])
    expect(await epochsOf('oura_raw_samples', REKEY_USER)).toEqual([
      { epoch: 0, n: 1 }, { epoch: 1, n: 1 },
    ])
    const { rows } = await pool.query(
      `SELECT epoch FROM oura_rollup_state WHERE user_id = $1`, [REKEY_USER])
    expect(rows).toEqual([{ epoch: 1 }])
  })

  it('drops the watermark of a user whose epochs moved, so the next rollup re-derives', async () => {
    await pool.query(MIGRATION)

    const { rows } = await pool.query(
      `SELECT epoch FROM oura_rollup_state WHERE user_id = $1`, [REDRAIN_USER])
    expect(rows).toEqual([])
  })

  it('is idempotent — a second run changes nothing', async () => {
    await pool.query(MIGRATION)
    const after1 = await epochsOf('oura_ble_clock_anchors', REDRAIN_USER)
    await pool.query(MIGRATION)
    expect(await epochsOf('oura_ble_clock_anchors', REDRAIN_USER)).toEqual(after1)
  })

  // The point of the whole exercise: before the merge, a ds resolves against the newest epoch,
  // whose offset is contaminated by drain backlog. After it, there is one epoch and the estimator
  // sees the clean anchors that dominate it.
  it('restores the clock offset a ds resolves at — the +14 h shift disappears', async () => {
    const probeDs = 30_000_000
    const trueMs = (RING_ORIGIN_SEC + probeDs / 10) * 1000

    // Hours out, not a specific number of them: this fixture's 40 anchors over a 4.7-day replay
    // reproduce the mechanism, not production's exact +14.16 h, which came from 695.
    const before = resolveDsToMs(probeDs, await anchorsOf(REDRAIN_USER))!
    expect((before - trueMs) / 3_600_000).toBeGreaterThan(10)

    await pool.query(MIGRATION)

    const after = resolveDsToMs(probeDs, await anchorsOf(REDRAIN_USER))!
    expect(Math.abs(after - trueMs)).toBeLessThan(60_000)
  })
})
