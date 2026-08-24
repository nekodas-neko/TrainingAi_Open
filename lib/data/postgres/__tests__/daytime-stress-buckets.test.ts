// TN-3a: the 30-minute daytime-stress buckets are persisted so "which hours run hottest" can be
// answered. `summarizeStressDay` reduces the series to three daily scalars, and those are too
// compressed for it — measured across 31 production days the daily aggregate spans only
// −0.14 … +0.23 on a [−1,+1] scale.
//
// These test the STORAGE layer against a real Postgres. The producer (the rollup's
// `buildDaytimeStressSeriesFromModel` pass) cannot run in this sandbox at all — it needs vendored
// constants that Q-49 removed from the repo — so the write is exercised through the same slice
// function the rollup's IO calls, not through the rollup itself. That gap is stated in the PR.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000005e2'
const OTHER_USER_ID = '00000000-0000-4000-8000-0000000005e3'

describe.skipIf(!canRun)('daytime stress buckets (TN-3a)', () => {
  let pool: import('pg').Pool
  let db: Awaited<ReturnType<typeof import('@/lib/data/postgres/client').getDb>>
  let oura: typeof import('@/lib/data/postgres/slices/oura')

  const at = (iso: string) => new Date(iso)

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    db = client.getDb()
    oura = await import('@/lib/data/postgres/slices/oura')
    for (const [id, email] of [[TEST_USER_ID, 'stress-buckets'], [OTHER_USER_ID, 'stress-buckets-other']]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`,
        [id, `${email}-${id}@example.com`],
      )
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[TEST_USER_ID, OTHER_USER_ID]])
  })

  it('round-trips a day of buckets in bucket order', async () => {
    await oura.replaceDaytimeStressBuckets(db, TEST_USER_ID, '2026-08-20', [
      { bucketStart: at('2026-08-20T01:00:00Z'), level: -0.4 },
      { bucketStart: at('2026-08-20T00:00:00Z'), level: 0.2 },
      { bucketStart: at('2026-08-20T00:30:00Z'), level: -0.9 },
    ])
    const rows = await oura.listDaytimeStressBuckets(db, TEST_USER_ID, '2026-08-20', '2026-08-20')
    // Ordered by instant, not by insertion.
    expect(rows.map(r => r.level)).toEqual([0.2, -0.9, -0.4])
    expect(rows.every(r => r.day === '2026-08-20')).toBe(true)
  })

  it('SHRINKS the day on a re-run that produces fewer buckets', async () => {
    // The behaviour a merge would get wrong. The series is recomputed as a unit, so a shorter
    // waking window or a frame that failed to decode must remove the stale buckets rather than
    // leave them merged in beside the new ones — where they would read as real stress.
    await oura.replaceDaytimeStressBuckets(db, TEST_USER_ID, '2026-08-21', [
      { bucketStart: at('2026-08-21T00:00:00Z'), level: -0.1 },
      { bucketStart: at('2026-08-21T00:30:00Z'), level: -0.2 },
      { bucketStart: at('2026-08-21T01:00:00Z'), level: -0.3 },
    ])
    await oura.replaceDaytimeStressBuckets(db, TEST_USER_ID, '2026-08-21', [
      { bucketStart: at('2026-08-21T00:00:00Z'), level: -0.15 },
    ])
    const rows = await oura.listDaytimeStressBuckets(db, TEST_USER_ID, '2026-08-21', '2026-08-21')
    expect(rows).toHaveLength(1)
    expect(rows[0].level).toBeCloseTo(-0.15, 6)
  })

  it('an empty series clears the day rather than leaving the previous pass behind', async () => {
    await oura.replaceDaytimeStressBuckets(db, TEST_USER_ID, '2026-08-22', [
      { bucketStart: at('2026-08-22T00:00:00Z'), level: -0.5 },
    ])
    await oura.replaceDaytimeStressBuckets(db, TEST_USER_ID, '2026-08-22', [])
    expect(await oura.listDaytimeStressBuckets(db, TEST_USER_ID, '2026-08-22', '2026-08-22')).toHaveLength(0)
  })

  it('replacing one day leaves the neighbouring days untouched', async () => {
    await oura.replaceDaytimeStressBuckets(db, TEST_USER_ID, '2026-08-25', [
      { bucketStart: at('2026-08-25T00:00:00Z'), level: -0.6 },
    ])
    await oura.replaceDaytimeStressBuckets(db, TEST_USER_ID, '2026-08-26', [
      { bucketStart: at('2026-08-26T00:00:00Z'), level: -0.7 },
    ])
    await oura.replaceDaytimeStressBuckets(db, TEST_USER_ID, '2026-08-25', [
      { bucketStart: at('2026-08-25T00:00:00Z'), level: -0.65 },
    ])
    const both = await oura.listDaytimeStressBuckets(db, TEST_USER_ID, '2026-08-25', '2026-08-26')
    expect(both.map(r => r.level)).toEqual([-0.65, -0.7])
  })

  it('keeps two users\' same-instant buckets separate', async () => {
    await oura.replaceDaytimeStressBuckets(db, OTHER_USER_ID, '2026-08-27', [
      { bucketStart: at('2026-08-27T00:00:00Z'), level: -0.8 },
    ])
    await oura.replaceDaytimeStressBuckets(db, TEST_USER_ID, '2026-08-27', [
      { bucketStart: at('2026-08-27T00:00:00Z'), level: -0.2 },
    ])
    const mine = await oura.listDaytimeStressBuckets(db, TEST_USER_ID, '2026-08-27', '2026-08-27')
    const theirs = await oura.listDaytimeStressBuckets(db, OTHER_USER_ID, '2026-08-27', '2026-08-27')
    expect(mine.map(r => r.level)).toEqual([-0.2])
    expect(theirs.map(r => r.level)).toEqual([-0.8])
  })

  // Deliberately NOT claimed as proof that the write's `setWhere` user-scope is load-bearing.
  // It is not: the primary key is `(user_id, bucket_start)`, so a cross-user conflict cannot
  // arise and removing `setWhere` leaves every test here green — confirmed by removing it. What
  // the case above DOES catch is the key ever narrowing to `bucket_start` alone, which would make
  // one user's rollup silently overwrite another's. The first draft of this test asserted the
  // stronger claim and would have shipped a comment the code did not support.

  it('reads a range inclusively and stays within it', async () => {
    for (const [day, level] of [['2026-09-01', -0.1], ['2026-09-02', -0.2], ['2026-09-03', -0.3]] as const) {
      await oura.replaceDaytimeStressBuckets(db, TEST_USER_ID, day, [
        { bucketStart: at(`${day}T00:00:00Z`), level },
      ])
    }
    const mid = await oura.listDaytimeStressBuckets(db, TEST_USER_ID, '2026-09-01', '2026-09-02')
    expect(mid.map(r => r.day)).toEqual(['2026-09-01', '2026-09-02'])
  })
})
