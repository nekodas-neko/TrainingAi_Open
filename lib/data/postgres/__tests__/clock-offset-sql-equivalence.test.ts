// RV-182 ② — `getOuraClockOffsets` computes in SQL the same per-epoch offset `robustOffsetMs`
// computes in JavaScript, so a caller that only converts timestamps stops pulling the whole anchor
// log into Node (2,190 calls x 9,736 rows, 106 s, 9.4% of all database time).
//
// **The equivalence is the whole change, so it is tested rather than argued**: every case runs both
// paths over the same anchors and compares. The offset is an ORDER STATISTIC — the k-th smallest
// lag with k = floor(n * LAG_PERCENTILE) — so the cases below sit where an off-by-one or a
// different rank rule would show: n straddling a 1/LAG_PERCENTILE boundary, ties at the chosen
// rank, a single anchor, and several epochs at once (where only the max is "current").
//
// `percentile_disc` is deliberately NOT used: its rank rule disagrees with `Math.floor(n * 0.1)`
// at small n, which is the trap RV-181 documented for the same kind of statistic.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { offsetsFromAnchors, type ClockAnchor } from '@/lib/oura-ble/clock'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000c182'
const T0 = Date.UTC(2026, 8, 1, 0, 0, 0)

describe.skipIf(!canRun)('getOuraClockOffsets — SQL matches robustOffsetMs', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let oura: typeof import('@/lib/data/postgres/slices/oura')

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool(); db = client.getDb()
    oura = await import('@/lib/data/postgres/slices/oura')
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, 'rv182-offsets@example.com'])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [USER])
  })

  /** Seed anchors and assert both paths agree, field for field. */
  async function bothAgree(anchors: ClockAnchor[]) {
    if (anchors.length) {
      await pool.query(
        `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc, epoch, observed_source)
         SELECT $1, ds, utc, ep, 'drain'
         FROM unnest($2::bigint[], $3::timestamptz[], $4::int[]) AS t(ds, utc, ep)`,
        [USER, anchors.map(a => a.anchorDs), anchors.map(a => new Date(a.anchorUtcMs).toISOString()),
         anchors.map(a => a.epoch)])
    }
    const viaSql = await oura.getOuraClockOffsets(db, USER)
    const viaJs = offsetsFromAnchors(anchors)
    expect(viaSql.epoch).toBe(viaJs.epoch)
    // The JS side memoises lazily, so ask it about every epoch the SQL answered for.
    for (const [ep, offset] of viaSql.offsets) {
      const { dsToMs } = await import('@/lib/oura-ble/clock')
      expect(dsToMs(0, viaSql, ep), `epoch ${ep}`).toBe(dsToMs(0, viaJs, ep))
      expect(offset).toBe(viaJs.offsets.get(ep) ?? dsToMs(0, viaJs, ep))
    }
    return viaSql
  }

  /** `n` anchors whose lags are 0, 1000, 2000 … ms above a true offset, shuffled on insert so
   *  neither path can be accidentally right by reading them in order. */
  const spread = (n: number, epoch = 0): ClockAnchor[] => {
    const out: ClockAnchor[] = []
    for (let i = 0; i < n; i++) {
      const anchorDs = 1_000_000 + i * 600
      out.push({ epoch, anchorDs, anchorUtcMs: anchorDs * 100 + T0 + i * 1000 })
    }
    return out.reverse()
  }

  it('agrees when the user has no anchors at all', async () => {
    const p = await bothAgree([])
    expect(p.epoch).toBeNull()
    expect(p.offsets.size).toBe(0)
  })

  it('agrees on a single anchor', async () => {
    const p = await bothAgree(spread(1))
    expect(p.epoch).toBe(0)
    expect(p.offsets.get(0)).toBe(T0)
  })

  // floor(n * 0.1) moves at each multiple of ten, so these straddle three of its steps.
  it('agrees either side of every rank boundary up to n = 31', async () => {
    for (const n of [9, 10, 11, 19, 20, 21, 29, 30, 31]) {
      await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [USER])
      const p = await bothAgree(spread(n))
      // k-th smallest lag with k = floor(n * 0.1), zero-based, and lag i is T0 + i * 1000.
      expect(p.offsets.get(0), `n=${n}`).toBe(T0 + Math.floor(n * 0.1) * 1000)
    }
  })

  it('agrees when the lag at the chosen rank is tied', async () => {
    const anchors = spread(20).map((a, i) => ({
      ...a,
      // Every anchor in the first half shares one lag, so the rank lands inside the tie.
      anchorUtcMs: i < 10 ? a.anchorDs * 100 + T0 : a.anchorUtcMs,
    }))
    await bothAgree(anchors)
  })

  it('agrees across several epochs, and calls the highest one current', async () => {
    const p = await bothAgree([...spread(12, 0), ...spread(15, 1), ...spread(11, 2)])
    expect(p.epoch).toBe(2)
    expect(p.offsets.size).toBe(3)
  })

  it('agrees when one epoch holds a single anchor and another holds many', async () => {
    const p = await bothAgree([...spread(1, 0), ...spread(25, 1)])
    expect(p.epoch).toBe(1)
    expect(p.offsets.get(0)).toBe(T0)
  })

  it("agrees, and neither path sees another user's anchors", async () => {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'UTC')
       ON CONFLICT (id) DO NOTHING`, ['00000000-0000-4000-8000-00000000c183', 'rv182-other@example.com'])
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc, epoch, observed_source)
       VALUES ($1, 5, to_timestamp(0), 9, 'drain')`, ['00000000-0000-4000-8000-00000000c183'])
    const p = await bothAgree(spread(12))
    expect(p.epoch).toBe(0)
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, ['00000000-0000-4000-8000-00000000c183'])
    await pool.query(`DELETE FROM users WHERE id = $1`, ['00000000-0000-4000-8000-00000000c183'])
  })
})
