// #3369 (e) — a write in flight during an admin reset either finishes first (and is wiped by it) or
// starts after it (and is refused). Nothing lands in the fresh account.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const U = '00000000-0000-4000-8000-0000003369a9'
const A = '00000000-0000-4000-8000-0000003369aa'
const email = (id: string) => `barrier-${id.slice(-4)}@example.com`

describe.skipIf(!canRun)('withUserWriteBarrier and a reset', () => {
  let pool: import('pg').Pool
  let barrier: typeof import('../user-write-barrier')
  let slice: typeof import('../slices/account-deletion')
  let db: ReturnType<typeof import('../client').getDb>

  const metrics = async () =>
    (await pool.query('SELECT count(*)::int AS n FROM body_metrics WHERE user_id = $1', [U])).rows[0].n as number
  const write = (date: string) =>
    pool.query(`INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, $2, 80)`, [U, date])
  const reset = () => slice.resetAccountData(db, U, {
    guard: { actingAdminId: A, ownerId: A, confirmEmail: email(U) },
    audit: { job: 'admin-reset-user-data', actor: `admin:${A}` },
    auditSubjectIds: [],
  } as never)

  beforeAll(async () => {
    const client = await import('../client')
    pool = client.getPool(); db = client.getDb()
    barrier = await import('../user-write-barrier')
    slice = await import('../slices/account-deletion')
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[U, A]])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active) VALUES
         ($1, $3, 'x', 'Australia/Brisbane', false, true), ($2, $4, 'x', 'Australia/Brisbane', true, true)`,
      [U, A, email(U), email(A)])
  })
  afterAll(async () => { if (canRun) await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[U, A]]) })

  it('runs the write for a sign-in the account has no cut-off against', async () => {
    const out = await barrier.withUserWriteBarrier(U, Math.floor(Date.now() / 1000), async () => { await write('2026-09-01'); return 'done' })
    expect(out).toBe('done')
    expect(await metrics()).toBe(1)
  })

  it('a reset waits for a write already in flight, and wipes what it wrote', async () => {
    let release!: () => void
    const held = new Promise<void>(r => { release = r })
    let started!: () => void
    const inside = new Promise<void>(r => { started = r })
    const inflight = barrier.withUserWriteBarrier(U, Math.floor(Date.now() / 1000), async () => {
      await write('2026-09-02'); started(); await held; await write('2026-09-03'); return 'late'
    })
    await inside
    let resetDone = false
    const resetting = reset().then(r => { resetDone = true; return r })
    await new Promise(r => setTimeout(r, 400))
    expect(resetDone, 'the reset is queued behind the in-flight write').toBe(false)
    release()
    expect(await inflight).toBe('late')
    expect((await resetting).deleted).toBe(true)
    expect(await metrics(), 'both writes made before the reset commit are gone').toBe(0)
  })

  it('a write that starts after the reset, from a sign-in older than it, is refused and writes nothing', async () => {
    const before = Math.floor(Date.now() / 1000) - 3600
    const out = await barrier.withUserWriteBarrier(U, before, async () => { await write('2026-09-04'); return 'wrote' })
    expect(out).toBe(barrier.CUT_OFF)
    expect(await metrics()).toBe(0)
  })

  it('a sign-in after the reset is allowed', async () => {
    const out = await barrier.withUserWriteBarrier(U, Math.floor(Date.now() / 1000) + 5, async () => { await write('2026-09-05'); return 'ok' })
    expect(out).toBe('ok')
  })

  it('a user that does not exist is refused', async () => {
    expect(await barrier.withUserWriteBarrier('00000000-0000-4000-8000-0000003369ff', 1, async () => 'x')).toBe(barrier.CUT_OFF)
  })

  it('releases the lock and the connection when the write throws', async () => {
    await expect(barrier.withUserWriteBarrier(U, Math.floor(Date.now() / 1000) + 5, async () => { throw new Error('boom') })).rejects.toThrow('boom')
    // A reset can take the lock straight away, so the shared lock did not leak.
    const t0 = Date.now()
    await reset()
    expect(Date.now() - t0).toBeLessThan(5000)
  })
})

// #3672 item 2: the lock connection and the query connection come from the same pool of ten. Ten
// covered writes at once used to make every connection a lock holder waiting for a query
// connection, and all ten failed after `connectionTimeoutMillis`.
describe.skipIf(!canRun)('withUserWriteBarrier under concurrency (#3672)', () => {
  const V = '00000000-0000-4000-8000-0000003672aa'
  let pool: import('pg').Pool
  let barrier: typeof import('../user-write-barrier')

  beforeAll(async () => {
    const client = await import('../client')
    pool = client.getPool()
    barrier = await import('../user-write-barrier')
    await pool.query('DELETE FROM users WHERE id = $1', [V])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active) VALUES ($1, $2, 'x', 'Australia/Brisbane', false, true)`,
      [V, 'barrier-3672@example.com'])
  })
  afterAll(async () => { if (canRun) await pool.query('DELETE FROM users WHERE id = $1', [V]) })

  it('scales the cap to the pool and always leaves a holder a connection to query on', () => {
    expect(barrier.maxBarrierHolders(10)).toBe(4)
    expect(barrier.maxBarrierHolders(5)).toBe(2)
    expect(barrier.maxBarrierHolders(2)).toBe(1)
    expect(barrier.maxBarrierHolders(1)).toBe(1)
  })

  it('twelve covered writes at once all succeed, never more than the cap hold a lock, and the pool stays usable', async () => {
    const signedInAt = Math.floor(Date.now() / 1000) + 5
    let peak = 0
    const runs = Array.from({ length: 12 }, (_, i) => barrier.withUserWriteBarrier(V, signedInAt, async () => {
      peak = Math.max(peak, barrier.barrierOccupancy().holders)
      // Three pooled queries per run, as the review's reproduction did, with a hold between them.
      for (let q = 0; q < 3; q++) await pool.query('SELECT pg_sleep(0.05)')
      return i
    }))
    // Another route's query, issued while the burst is in flight, is not starved.
    const t0 = Date.now()
    await pool.query('SELECT 1')
    expect(Date.now() - t0, 'an unrelated query waited on the pool').toBeLessThan(2000)

    const out = await Promise.allSettled(runs)
    expect(out.filter(r => r.status === 'rejected')).toEqual([])
    expect(out.map(r => (r as PromiseFulfilledResult<number>).value)).toEqual(Array.from({ length: 12 }, (_, i) => i))
    expect(peak).toBeLessThanOrEqual(barrier.maxBarrierHolders())
    expect(barrier.barrierOccupancy()).toEqual({ holders: 0, waiting: 0 })
  }, 20_000)

  it('a write that throws gives its slot back', async () => {
    const signedInAt = Math.floor(Date.now() / 1000) + 5
    await Promise.allSettled(Array.from({ length: 6 }, () =>
      barrier.withUserWriteBarrier(V, signedInAt, async () => { throw new Error('boom') })))
    expect(barrier.barrierOccupancy()).toEqual({ holders: 0, waiting: 0 })
  })
})
