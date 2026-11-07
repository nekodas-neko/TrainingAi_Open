// #3654 and #3672 item 1, on the real adapter and the local Postgres.
//
// #3654: the `updated_at` trigger stamps `now()`, the writer's transaction start, and the row is
// visible only at COMMIT. A pull that runs while that transaction is open cannot see the row, and
// its cursor used to be the time AFTER its reads, which is later than the row's stamp. The next pull
// asked for `updated_at > cursor` and never delivered the row.
//
// #3672 item 1: a page ended inside a group of rows sharing one stamp, and the cursor (`max − 1 ms`)
// re-read the same group on every page, so a group larger than a page stalled the pull for good.
//
// Runs only against a real local dev Postgres — skips cleanly without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003654'

describe.skipIf(!canRun)('sync pull cursor (#3654, #3672)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [USER, `sync-cursor-3654-${USER}@example.com`],
    )
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [USER])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  const datesOf = (rows: unknown[]) => (rows as { date: string }[]).map(r => String(r.date))

  it('a row committed while a pull runs is delivered by the next pull', async () => {
    await pool.query(`INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, '2026-11-01', 1)`, [USER])
    const first = await repo.getSyncDelta(USER, new Date(0))
    expect(datesOf(first.bodyMetrics)).toEqual(['2026-11-01'])

    // A second connection edits the row inside an open transaction: the trigger stamps the
    // transaction's start, and the pull below cannot see the row until COMMIT.
    const writer = await pool.connect()
    let duringPull: Awaited<ReturnType<typeof repo.getSyncDelta>>
    try {
      await writer.query('BEGIN')
      await writer.query(`UPDATE body_metrics SET weight_kg = 2 WHERE user_id = $1 AND date = '2026-11-01'`, [USER])
      await new Promise(r => setTimeout(r, 20))
      duringPull = await repo.getSyncDelta(USER, new Date(first.syncedAt))
      await writer.query('COMMIT')
    } finally {
      writer.release()
    }
    const edited = (duringPull.bodyMetrics as { weightKg: number }[]).filter(r => r.weightKg === 2)
    expect(edited).toHaveLength(0)

    const stamp = (await pool.query(
      `SELECT updated_at FROM body_metrics WHERE user_id = $1 AND date = '2026-11-01'`, [USER],
    )).rows[0].updated_at as Date
    // The miss, stated: the cursor must not have passed the committed row's stamp.
    expect(Date.parse(duringPull.syncedAt)).toBeLessThan(stamp.getTime())

    const next = await repo.getSyncDelta(USER, new Date(duringPull.syncedAt))
    expect((next.bodyMetrics as { weightKg: number }[]).map(r => r.weightKg)).toEqual([2])
  })

  it('more than a page of rows sharing one updated_at drains instead of stalling', async () => {
    const pageLimit = 25
    // One statement, so the trigger's `now()` gives all 60 rows the same stamp; a later row too.
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, weight_kg)
       SELECT $1, DATE '2026-01-01' + g, 1 FROM generate_series(0, 59) g`,
      [USER],
    )
    await new Promise(r => setTimeout(r, 5))
    await pool.query(`INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, '2026-06-01', 1)`, [USER])

    const seen = new Set<string>()
    let since = new Date(0)
    let pages = 0
    for (; pages < 10; pages++) {
      const delta = await repo.getSyncDelta(USER, since, null, pageLimit)
      for (const d of datesOf(delta.bodyMetrics)) seen.add(d)
      if (!delta.hasMore) break
      expect(Date.parse(delta.syncedAt), 'the cursor advances every page').toBeGreaterThan(since.getTime())
      since = new Date(delta.syncedAt)
    }
    expect(pages).toBeLessThan(10)
    expect(seen.size).toBe(61)
  })

  it('a page still holds at most pageLimit rows when no stamps tie', async () => {
    // Stamps a second apart, so no two rows share a millisecond.
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, weight_kg, updated_at)
       SELECT $1, DATE '2026-02-01' + g, 1, now() - interval '1 hour' + g * interval '1 second'
         FROM generate_series(0, 4) g`,
      [USER],
    )
    const delta = await repo.getSyncDelta(USER, new Date(0), null, 3)
    expect(delta.bodyMetrics).toHaveLength(3)
    expect(delta.hasMore).toBe(true)
  })
})
