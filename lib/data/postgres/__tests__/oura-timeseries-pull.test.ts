// Track-B B2/B4/B5: the dedicated timeseries pull (getOuraTimeseriesDelta).
//  - B2: keyset (updated_at, id) cursor drains a >budget series fully — no dup, no skip.
//  - B4: a batch ALL sharing one updated_at (a bulk-now() rollup chunk) still drains fully —
//        the exact case the shared scalar `−1ms` cursor would stall on forever.
//  - B5: N concurrent full-restore drains stay within the pool budget (max:10) and release
//        every connection (no leak) — the I19 pool-starvation gate.
//
// **Why this file survives a method with no production caller (Q-180, decided 2026-08-14):** the
// route that called it was deleted with owner approval in Q-136, but the method is kept because
// intraday HR reaches a fresh device by no other path — `ouraHeartrate` is absent from `SyncDelta`
// entirely, and the owner's 2026-08-02 retention decision makes the device-local raw store a 14-day
// rolling window with the server as the archive. These tests are the proof the DB half works, for
// whoever writes the restore driver. See the doc comment on `getOuraTimeseriesDelta`.
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
// Was …d014, which oura-daily-summary-sync.test.ts also used. Two DB-touching files on one id delete each
// other's rows in parallel workers; `scripts/check-test-user-ids.js` keeps them distinct.
const TEST_USER_ID = '00000000-0000-4000-8000-00000000d0a3'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('Track-B dedicated timeseries pull (B2/B4/B5)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const seedHr = async (count: number, opts: { sharedUpdatedAt?: boolean } = {}) => {
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [TEST_USER_ID])
    // Unique `timestamp` per row (the (user_id, timestamp) constraint); updated_at either
    // distinct-per-row (normal) or a single shared instant (the B4 bulk-now() case).
    const updatedExpr = opts.sharedUpdatedAt
      ? `timestamptz '2026-07-01 00:00:00+00'`
      : `timestamptz '2026-07-01 00:00:00+00' + (g || ' seconds')::interval`
    await pool.query(
      `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source, updated_at)
       SELECT $1, timestamptz '2026-06-01 00:00:00+00' + (g || ' minutes')::interval,
              60 + (g % 40), 'ble', ${updatedExpr}
       FROM generate_series(1, $2) g`,
      [TEST_USER_ID, count],
    )
  }

  const drainHr = async (budget: number) => {
    let cursor: { updatedAt: string; id: string } | null = null
    let hasMore = true
    let pages = 0
    const rows: { id: string; updatedAt: string }[] = []
    while (hasMore) {
      const { heartrate } = await repo.getOuraTimeseriesDelta(TEST_USER_ID, { heartrate: cursor, budget })
      rows.push(...heartrate.rows.map(r => ({ id: r.id, updatedAt: r.updatedAt })))
      cursor = heartrate.cursor
      hasMore = heartrate.hasMore
      if (++pages > 5000) throw new Error('drain did not terminate — cursor not advancing')
    }
    return { rows, pages }
  }

  beforeAll(async () => {
    const clientMod = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = clientMod.getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `ts-pull-${TEST_USER_ID}@example.com`, TZ],
    )
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_bucket WHERE user_id = $1`, [TEST_USER_ID])
  })

  it('B2: keyset cursor drains a >budget series exactly once, in order', async () => {
    await seedHr(130)
    const { rows, pages } = await drainHr(50) // 130 rows / 50 ⇒ 3 pages
    expect(rows.length).toBe(130)
    expect(new Set(rows.map(r => r.id)).size).toBe(130) // no duplicate, no skip
    expect(pages).toBe(3)
    const ts = rows.map(r => Date.parse(r.updatedAt))
    expect(ts).toEqual([...ts].sort((a, b) => a - b)) // non-decreasing updated_at
  })

  it('B4: a batch all sharing one updated_at still drains fully (scalar cursor would stall)', async () => {
    await seedHr(130, { sharedUpdatedAt: true })
    const { rows } = await drainHr(50)
    expect(rows.length).toBe(130)
    expect(new Set(rows.map(r => r.id)).size).toBe(130)
    // Every row shares the instant — only the (updated_at, id) tiebreak makes this drain.
    expect(new Set(rows.map(r => r.updatedAt)).size).toBe(1)
  })

  it('B2: an empty series returns a drained, cursorless page', async () => {
    await seedHr(0)
    const { heartrate } = await repo.getOuraTimeseriesDelta(TEST_USER_ID, { heartrate: null, budget: 50 })
    expect(heartrate.rows).toEqual([])
    expect(heartrate.hasMore).toBe(false)
    expect(heartrate.cursor).toBeNull()
  })

  it('bucket: coarse buckets round-trip through the keyset pull with full columns', async () => {
    await pool.query(`DELETE FROM oura_bucket WHERE user_id = $1`, [TEST_USER_ID])
    const oura = await import('@/lib/data/postgres/slices/oura')
    const db = (await import('@/lib/data/postgres/client')).getDb()
    await oura.upsertOuraBucket(db, TEST_USER_ID, [{
      tier: 'coarse', bucketStartMs: 1783468800000, bucketStartDs: 17834688000, localDate: '2026-07-08',
      hrMean: 62.5, hrMin: 48, hrMax: 141, hrvRmssdMs: 44.2, spo2Pct: 97.1, perfusionIndex: 1.2,
      skinTempC: 33.4, metMean: 1.3, metMinutes: 120, motionMad: 0.02, ibiMs: '900,910,905', sampleCount: 288,
    }])
    const { bucket } = await repo.getOuraTimeseriesDelta(TEST_USER_ID, { bucket: null, budget: 50 })
    expect(bucket.rows.length).toBe(1)
    const b = bucket.rows[0]
    expect(b.tier).toBe('coarse')
    expect(b.bucketStartMs).toBe(1783468800000)
    expect(b.hrMean).toBe(62.5)
    expect(b.hrvRmssdMs).toBe(44.2)
    expect(b.ibiMs).toBe('900,910,905')
    expect(b.sampleCount).toBe(288)
    expect(bucket.hasMore).toBe(false)
  })

  it('B5: 10 concurrent full-restore drains stay within the pool budget and leak nothing', async () => {
    await seedHr(600)
    const before = pool.totalCount
    let maxTotal = 0
    let sampling = true
    const sampler = (async () => {
      while (sampling) {
        maxTotal = Math.max(maxTotal, pool.totalCount)
        await new Promise(r => setTimeout(r, 2))
      }
    })()

    const drains = await Promise.all(Array.from({ length: 10 }, () => drainHr(100)))
    sampling = false
    await sampler

    for (const d of drains) {
      expect(d.rows.length).toBe(600) // every concurrent drain saw the whole series
      expect(new Set(d.rows.map(r => r.id)).size).toBe(600)
    }
    // pg Pool caps at max:10 — the dedicated endpoint holds ONE connection per request, so
    // 10 concurrent drains never blow the budget, and every connection is released after.
    expect(maxTotal).toBeLessThanOrEqual(10)
    expect(pool.waitingCount).toBe(0)
    // No connection leak: active checkouts return to the pre-test level.
    expect(pool.totalCount - pool.idleCount).toBeLessThanOrEqual(Math.max(0, before))
  }, 30_000)
})
